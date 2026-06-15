/**
 * GSTR-3B builder (#131 — GST Phase 2 of #107).
 *
 * GSTR-3B is the self-declared monthly summary return filed by the 20th
 * (or 22nd/24th for QRMP) of the next month. Pulls from the same data
 * as GSTR-1 on the outward side, plus GRN lines for ITC on the inward
 * side.
 *
 * Phase 2 (this) covers the rows that auto-fill from existing tables:
 *
 *   3.1(a)  Outward taxable supplies (other than zero-rated, nil-rated, exempt)
 *   3.1(c)  Other outward supplies (nil-rated, exempted)   ← gstRate=0 rows
 *   3.2     Of 3.1(a) — inter-state supplies to UNREGISTERED  (POS + rate)
 *   4(A5)   "All other ITC" — sum of GRN tax from REGULAR vendors
 *   4(C)    Net ITC available = A5 (since A1-A4 + B not modeled yet)
 *
 * Deferred (admin enters on portal directly until later phases):
 *   3.1(b)  Zero-rated supplies (exports / SEZ)
 *   3.1(d)  Inward supplies liable to reverse charge
 *   3.1(e)  Non-GST outward supplies
 *   4(A1-A4) Import goods / services / RCM / ISD
 *   4(B)    ITC Reversed (Rule 38, 42, 43)
 *   4(D)    Reclaimed + ineligible ITC
 *   5       Exempt/nil/non-GST inward
 *   5.1     Interest & late fee
 *   6       Payment of tax (admin computes net cash payable)
 */
import { prisma } from "@/lib/db";
import { monthRange, fpCode } from "@/lib/gst/period";
import {
  getGstStateCode,
  isB2BRegType,
} from "@/lib/constants";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type GSTR3BTaxBlock = {
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
};

const ZERO: GSTR3BTaxBlock = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

export type GSTR3B_3_2_Row = {
  posCode: string;
  posState: string;
  rate: number;
  /** Recipient classification — UR=Unregistered · COMP=Composition · UIN=UIN-holder.
   *  GSTR-3B 3.2 has separate sub-blocks but for Phase 2 we collapse them
   *  since UR drives 95% of small-business cases. */
  recipient: "UR" | "COMP" | "UIN";
  taxableValue: number;
  igst: number;
};

export type GSTR3BReport = {
  period: string;
  fp: string;
  gstin: string;
  sellerState: string;
  generatedAt: Date;
  /** Section 3.1 — Tax on outward + reverse charge */
  s3_1: {
    a_outward_taxable: GSTR3BTaxBlock;      // 3.1(a)
    b_zero_rated: GSTR3BTaxBlock;           // 3.1(b)  — placeholder
    c_nil_rated_exempt: GSTR3BTaxBlock;     // 3.1(c)
    d_inward_reverse_charge: GSTR3BTaxBlock; // 3.1(d) — placeholder
    e_non_gst: GSTR3BTaxBlock;              // 3.1(e)  — placeholder
  };
  /** Section 3.2 — Of 3.1(a), inter-state supplies to unregistered persons. */
  s3_2: GSTR3B_3_2_Row[];
  /** Section 4 — Eligible ITC */
  s4: {
    a1_import_goods: GSTR3BTaxBlock;          // placeholder
    a2_import_services: GSTR3BTaxBlock;       // placeholder
    a3_reverse_charge: GSTR3BTaxBlock;        // placeholder
    a4_isd: GSTR3BTaxBlock;                   // placeholder
    a5_all_other_itc: GSTR3BTaxBlock;         // ← computed from GRN
    a_total: GSTR3BTaxBlock;
    b1_rule_38_42_43: GSTR3BTaxBlock;         // placeholder
    b2_others: GSTR3BTaxBlock;                // placeholder
    b_total: GSTR3BTaxBlock;
    c_net_itc: GSTR3BTaxBlock;
  };
  /** Section 6 — net tax payable (very rough — admin tunes on portal). */
  s6_summary: {
    outputTaxTotal: GSTR3BTaxBlock;   // tax on 3.1(a) + 3.1(b)
    inputItcTotal: GSTR3BTaxBlock;    // s4.c
    /** Net cash payable per head. Negative = ITC excess → ledger credit. */
    netPayable: GSTR3BTaxBlock;
  };
  warnings: string[];
};

export async function buildGSTR3B(input: {
  period: string;
  gstin?: string;
}): Promise<GSTR3BReport> {
  const { from, to } = monthRange(input.period);
  const filingGstin = await resolveFilingGstin(input.gstin);
  const sellerStateCode = getGstStateCode(filingGstin.state) ?? "";

  const warnings: string[] = [];

  // ── Section 3.1(a) + 3.1(c) — outward supplies ──────────────────────
  // Pull every SALE / RETURN / RTO order in the period. Returns net out.
  const orders = await prisma.marketplaceOrder.findMany({
    where: { date: { gte: from, lt: to } },
    select: {
      type: true, channel: true, gstRate: true,
      taxableValue: true, cgst: true, sgst: true, igst: true,
      customer: { select: { gstRegType: true, gst: true, state: true } },
      placeOfSupply: true,
      warehouse: { select: { state: true } },
    },
  });

  const a = mutBlock();              // 3.1(a) outward taxable
  const c = mutBlock();              // 3.1(c) nil-rated / exempted
  const s32Buckets = new Map<string, GSTR3B_3_2_Row>();

  for (const o of orders) {
    const sign = o.type === "RETURN" || o.type === "RTO" ? -1 : 1;
    const taxable = o.taxableValue * sign;
    const cgst = o.cgst * sign;
    const sgst = o.sgst * sign;
    const igst = o.igst * sign;

    if (o.gstRate === 0) {
      // 3.1(c) — nil-rated / exempt. Tax is zero by definition.
      c.taxableValue += taxable;
    } else {
      // 3.1(a) — taxable.
      a.taxableValue += taxable;
      a.cgst += cgst;
      a.sgst += sgst;
      a.igst += igst;
    }

    // Section 3.2 only applies to inter-state UR/COMP/UIN sales in 3.1(a).
    if (sign === 1 && o.gstRate > 0 && (igst > 0)) {
      // inter-state (IGST charged) AND non-B2B
      const isUR = !isB2BRegType(o.customer?.gstRegType ?? null);
      if (isUR) {
        const posState =
          o.customer?.state?.trim() ||
          o.placeOfSupply?.trim() ||
          o.warehouse?.state?.trim() ||
          filingGstin.state;
        const posCode = getGstStateCode(posState) ?? sellerStateCode;
        const key = `${posCode}|${o.gstRate}`;
        const existing = s32Buckets.get(key);
        if (existing) {
          existing.taxableValue += taxable;
          existing.igst += igst;
        } else {
          s32Buckets.set(key, {
            posCode,
            posState,
            rate: o.gstRate,
            recipient: "UR",
            taxableValue: taxable,
            igst,
          });
        }
      }
    }
  }

  // ── Section 4(A5) "All other ITC" — sum of GRN tax in period ────────
  // Filter to PURCHASE (not RTV/RFV) from REGULAR vendors only — composition
  // and unregistered vendors don't generate ITC.
  const grns = await prisma.gRN.findMany({
    where: {
      grnDate: { gte: from, lt: to },
      isDraft: false,
      type: "PURCHASE",
      vendor: { gstRegType: "REGULAR" },
    },
    select: {
      grnNo: true,
      total: true,
      vendor: { select: { name: true, state: true, gst: true } },
      items: { select: { taxableValue: true, tax: true } },
    },
  });

  const a5 = mutBlock();
  let itcGrnCount = 0;
  for (const g of grns) {
    const intraState = g.vendor.state?.trim() === filingGstin.state;
    const totalTaxable = g.items.reduce((s, it) => s + it.taxableValue, 0);
    const totalTax = g.items.reduce((s, it) => s + it.tax, 0);
    a5.taxableValue += totalTaxable;
    if (intraState) {
      // Half CGST + half SGST. GRN model doesn't split (yet) so we infer.
      const half = totalTax / 2;
      a5.cgst += half;
      a5.sgst += half;
    } else {
      a5.igst += totalTax;
    }
    itcGrnCount++;
    if (!g.vendor.gst) {
      warnings.push(`GRN ${g.grnNo}: vendor ${g.vendor.name} marked REGULAR but has no GSTIN — verify ITC eligibility.`);
    }
  }

  // ── Roll-ups ────────────────────────────────────────────────────────
  const s4 = {
    a1_import_goods: { ...ZERO },
    a2_import_services: { ...ZERO },
    a3_reverse_charge: { ...ZERO },
    a4_isd: { ...ZERO },
    a5_all_other_itc: roundBlock(a5),
    a_total: roundBlock(a5),                      // until A1-A4 are modeled
    b1_rule_38_42_43: { ...ZERO },
    b2_others: { ...ZERO },
    b_total: { ...ZERO },
    c_net_itc: roundBlock(a5),                    // A_total - B_total
  };

  const s3_1 = {
    a_outward_taxable: roundBlock(a),
    b_zero_rated: { ...ZERO },
    c_nil_rated_exempt: roundBlock(c),
    d_inward_reverse_charge: { ...ZERO },
    e_non_gst: { ...ZERO },
  };

  // Section 6 — net cash payable per head
  const output = roundBlock({
    taxableValue: 0,
    igst: s3_1.a_outward_taxable.igst + s3_1.b_zero_rated.igst,
    cgst: s3_1.a_outward_taxable.cgst + s3_1.b_zero_rated.cgst,
    sgst: s3_1.a_outward_taxable.sgst + s3_1.b_zero_rated.sgst,
    cess: 0,
  });
  const input_itc = s4.c_net_itc;
  const net: GSTR3BTaxBlock = {
    taxableValue: 0,
    igst: round2(output.igst - input_itc.igst),
    cgst: round2(output.cgst - input_itc.cgst),
    sgst: round2(output.sgst - input_itc.sgst),
    cess: 0,
  };

  if (itcGrnCount === 0 && grns.length === 0) {
    warnings.push("No ITC-eligible GRNs in this period — verify all REGULAR vendor purchases were posted.");
  }

  return {
    period: input.period,
    fp: fpCode(input.period),
    gstin: filingGstin.gstin,
    sellerState: filingGstin.state,
    generatedAt: new Date(),
    s3_1,
    s3_2: Array.from(s32Buckets.values())
      .map((r) => ({ ...r, taxableValue: round2(r.taxableValue), igst: round2(r.igst) }))
      .sort((a, b) => a.posCode.localeCompare(b.posCode) || a.rate - b.rate),
    s4,
    s6_summary: {
      outputTaxTotal: output,
      inputItcTotal: input_itc,
      netPayable: net,
    },
    warnings,
  };
}

function mutBlock(): GSTR3BTaxBlock {
  return { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

function roundBlock(b: GSTR3BTaxBlock): GSTR3BTaxBlock {
  return {
    taxableValue: round2(b.taxableValue),
    igst: round2(b.igst),
    cgst: round2(b.cgst),
    sgst: round2(b.sgst),
    cess: round2(b.cess),
  };
}

async function resolveFilingGstin(requested?: string): Promise<{ gstin: string; state: string }> {
  if (requested) {
    const g = await prisma.companyGSTIN.findUnique({
      where: { gstin: requested },
      select: { gstin: true, state: true, isActive: true },
    });
    if (g && g.isActive) return { gstin: g.gstin, state: g.state };
  }
  const primary = await prisma.companyGSTIN.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { gstin: true, state: true },
  });
  if (!primary) throw new Error("No active CompanyGSTIN — set one up under Settings → Company Profile.");
  return { gstin: primary.gstin, state: primary.state };
}
