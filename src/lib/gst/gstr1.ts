/**
 * GSTR-1 builder (#128 — Phase 1 of #107 GST module).
 *
 * Aggregates MarketplaceOrder rows for a YYYY-MM period into the four
 * sections that almost every Indian small/mid business actually files:
 *
 *   - 4A B2B Regular   — sales to registered customers (one row per invoice)
 *   - 7  B2CS          — B2C summarized by Place-of-Supply + Rate
 *   - 9B CDNR          — credit / debit notes to registered customers
 *   - 12 HSN Summary   — qty + value + tax aggregated by HSN + Rate
 *
 * Phase 1 deferred (notes are in #124 / todo.md):
 *   - 5A B2C Large >₹2.5L inter-state — currently merged into 7
 *   - 6A Exports / SEZ
 *   - 9C CDN Unregistered
 *   - 13 Documents Issued (range + cancelled count)
 *
 * Returns a structured object the page renders as tabs and the export
 * actions stream out as CSV per section + a single GST-portal-shaped JSON.
 */
import { prisma } from "@/lib/db";
import { monthRange, fpCode } from "@/lib/gst/period";
import {
  getGstStateCode,
  isB2BRegType,
} from "@/lib/constants";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type GSTR1B2BLine = {
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
};

export type GSTR1B2BInvoice = {
  invoiceNo: string;
  invoiceDate: Date;
  customerName: string;
  customerGstin: string;
  posCode: string;          // 2-digit state code
  posState: string;
  reverseCharge: boolean;
  invoiceType: "R" | "SEZWP" | "SEZWOP" | "DE";  // R = Regular
  invoiceValue: number;
  lines: GSTR1B2BLine[];
  /** Internal — order id for drill-back link. */
  orderId: string;
};

export type GSTR1B2CSRow = {
  posCode: string;
  posState: string;
  rate: number;
  /** Type: OE = Online Excluding e-commerce; E = E-commerce.
   *  Marketplace orders are flagged "E"; direct retail "OE". */
  type: "OE" | "E";
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** Internal — count of orders rolled into this bucket. */
  orderCount: number;
};

export type GSTR1CDNRNote = {
  noteNo: string;
  noteDate: Date;
  noteType: "C" | "D";  // Credit / Debit — RETURN/RTO = C
  customerName: string;
  customerGstin: string;
  posCode: string;
  posState: string;
  reverseCharge: boolean;
  noteValue: number;
  lines: GSTR1B2BLine[];
  /** Original invoice number this note adjusts. May be null when the
   *  marketplace return came in without an invoice link — UI flags. */
  originalInvoiceNo: string | null;
  originalInvoiceDate: Date | null;
  orderId: string;
};

export type GSTR1HSNRow = {
  hsn: string;
  description: string | null;
  uqc: string;       // unit-of-quantity code — "NOS" default for pieces
  rate: number;
  totalQty: number;
  totalValue: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
};

export type GSTR1Summary = {
  /** Total invoices counted in B2B + CDNR. */
  documentCount: number;
  /** Total taxable across all four sections. */
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalCess: number;
  totalInvoiceValue: number;
  /** Issues the page should surface to admin before they file. */
  warnings: string[];
};

export type GSTR1Report = {
  period: string;       // YYYY-MM
  fp: string;           // MMYYYY for portal
  gstin: string;        // filer's GSTIN
  sellerState: string;  // for intra/inter classification reference
  generatedAt: Date;
  summary: GSTR1Summary;
  b2b: GSTR1B2BInvoice[];
  b2cs: GSTR1B2CSRow[];
  cdnr: GSTR1CDNRNote[];
  hsn: GSTR1HSNRow[];
};

export type BuildGSTR1Input = {
  period: string;   // YYYY-MM
  /** Filer's GSTIN. If omitted, falls back to the primary CompanyGSTIN. */
  gstin?: string;
};

export async function buildGSTR1(input: BuildGSTR1Input): Promise<GSTR1Report> {
  const { from, to } = monthRange(input.period);

  // 1. Resolve the filing GSTIN + seller state (used for intra/inter test).
  const filingGstin = await resolveFilingGstin(input.gstin);
  const sellerStateCode = getGstStateCode(filingGstin.state) ?? "";

  // 2. Pull every order row that falls in the period. SALE → B2B / B2CS;
  //    RETURN + RTO → CDNR.
  const orders = await prisma.marketplaceOrder.findMany({
    where: { date: { gte: from, lt: to } },
    include: {
      item: { select: { hsn: true, name: true, skuCode: true } },
      customer: { select: { name: true, gst: true, gstRegType: true, state: true } },
      warehouse: { select: { state: true, name: true } },
    },
    orderBy: [{ invoiceNo: "asc" }, { date: "asc" }],
  });

  const warnings: string[] = [];
  const b2b: GSTR1B2BInvoice[] = [];
  const cdnr: GSTR1CDNRNote[] = [];
  const b2csBuckets = new Map<string, GSTR1B2CSRow>();
  const hsnBuckets = new Map<string, GSTR1HSNRow>();

  for (const o of orders) {
    const isReturn = o.type === "RETURN" || o.type === "RTO";

    // Place of Supply — prefer customer.state, then placeOfSupply text,
    // then warehouse.state, then seller state as last-resort.
    const posState =
      o.customer?.state?.trim() ||
      o.placeOfSupply?.trim() ||
      o.warehouse?.state?.trim() ||
      filingGstin.state;
    const posCode = getGstStateCode(posState) ?? sellerStateCode;

    const taxable = round2(o.taxableValue);
    const cgst = round2(o.cgst);
    const sgst = round2(o.sgst);
    const igst = round2(o.igst);
    const cess = 0; // cess column not modeled yet; placeholder
    const total = round2(o.total);
    const rate = round2(o.gstRate);

    // ── HSN Summary (every order contributes) ────────────────────────
    if (o.item.hsn) {
      const hsnKey = `${o.item.hsn}|${rate}`;
      const existing = hsnBuckets.get(hsnKey);
      const sign = isReturn ? -1 : 1;
      if (existing) {
        existing.totalQty += o.qty * sign;
        existing.totalValue += total * sign;
        existing.taxableValue += taxable * sign;
        existing.cgst += cgst * sign;
        existing.sgst += sgst * sign;
        existing.igst += igst * sign;
        existing.cess += cess * sign;
      } else {
        hsnBuckets.set(hsnKey, {
          hsn: o.item.hsn,
          description: o.item.name,
          uqc: "NOS",
          rate,
          totalQty: o.qty * sign,
          totalValue: total * sign,
          taxableValue: taxable * sign,
          cgst: cgst * sign,
          sgst: sgst * sign,
          igst: igst * sign,
          cess: cess * sign,
        });
      }
    } else {
      warnings.push(`Order ${o.id.slice(-8)} missing HSN — excluded from HSN Summary.`);
    }

    // ── B2B (Section 4A) vs B2CS (Section 7) vs CDNR (Section 9B) ───
    const customerIsB2B = isB2BRegType(o.customer?.gstRegType ?? null) && !!o.customer?.gst;

    if (isReturn) {
      // Credit / Debit notes
      if (customerIsB2B && o.customer) {
        cdnr.push({
          noteNo: o.invoiceNo ?? `CN-${o.id.slice(-6)}`,
          noteDate: o.invoiceDate ?? o.date,
          noteType: "C",
          customerName: o.customer.name,
          customerGstin: o.customer.gst ?? "",
          posCode,
          posState,
          reverseCharge: o.revCharge,
          noteValue: total,
          originalInvoiceNo: null, // Phase 2 will link from RETURN remarks
          originalInvoiceDate: null,
          orderId: o.id,
          lines: [{ rate, taxableValue: taxable, cgst, sgst, igst, cess }],
        });
      } else {
        // B2C return — net out of B2CS for that POS+rate.
        const isE = o.channel === "MARKETPLACE";
        const bucketKey = `${posCode}|${rate}|${isE ? "E" : "OE"}`;
        const existing = b2csBuckets.get(bucketKey);
        if (existing) {
          existing.taxableValue -= taxable;
          existing.cgst -= cgst;
          existing.sgst -= sgst;
          existing.igst -= igst;
          existing.cess -= cess;
          existing.orderCount += 1;
        } else {
          b2csBuckets.set(bucketKey, {
            posCode,
            posState,
            rate,
            type: isE ? "E" : "OE",
            taxableValue: -taxable,
            cgst: -cgst,
            sgst: -sgst,
            igst: -igst,
            cess: -cess,
            orderCount: 1,
          });
        }
      }
    } else if (customerIsB2B && o.customer) {
      // B2B detail row — needs an invoiceNo. If missing (legacy data),
      // synthesize from the order id and emit a warning so admin can fix.
      const invoiceNo = o.invoiceNo ?? `INV-LEGACY-${o.id.slice(-6)}`;
      if (!o.invoiceNo) {
        warnings.push(`B2B order ${o.id.slice(-8)} has no invoice number — synthesized one, please assign a real INV.`);
      }
      b2b.push({
        invoiceNo,
        invoiceDate: o.invoiceDate ?? o.date,
        customerName: o.customer.name,
        customerGstin: o.customer.gst ?? "",
        posCode,
        posState,
        reverseCharge: o.revCharge,
        invoiceType: "R",
        invoiceValue: total,
        orderId: o.id,
        lines: [{ rate, taxableValue: taxable, cgst, sgst, igst, cess }],
      });
    } else {
      // B2CS bucket
      const isE = o.channel === "MARKETPLACE";
      const bucketKey = `${posCode}|${rate}|${isE ? "E" : "OE"}`;
      const existing = b2csBuckets.get(bucketKey);
      if (existing) {
        existing.taxableValue += taxable;
        existing.cgst += cgst;
        existing.sgst += sgst;
        existing.igst += igst;
        existing.cess += cess;
        existing.orderCount += 1;
      } else {
        b2csBuckets.set(bucketKey, {
          posCode,
          posState,
          rate,
          type: isE ? "E" : "OE",
          taxableValue: taxable,
          cgst,
          sgst,
          igst,
          cess,
          orderCount: 1,
        });
      }
    }
  }

  // Round every bucket once at the end (cuts floating-point fuzz).
  const b2cs = Array.from(b2csBuckets.values())
    .map((r) => ({
      ...r,
      taxableValue: round2(r.taxableValue),
      cgst: round2(r.cgst),
      sgst: round2(r.sgst),
      igst: round2(r.igst),
      cess: round2(r.cess),
    }))
    .sort((a, b) => a.posCode.localeCompare(b.posCode) || a.rate - b.rate);

  const hsn = Array.from(hsnBuckets.values())
    .map((r) => ({
      ...r,
      totalQty: round2(r.totalQty),
      totalValue: round2(r.totalValue),
      taxableValue: round2(r.taxableValue),
      cgst: round2(r.cgst),
      sgst: round2(r.sgst),
      igst: round2(r.igst),
      cess: round2(r.cess),
    }))
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);

  // Summary roll-up across all four sections.
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0, totalCess = 0, totalValue = 0;
  for (const i of b2b) {
    totalValue += i.invoiceValue;
    for (const l of i.lines) {
      totalTaxable += l.taxableValue;
      totalCgst += l.cgst;
      totalSgst += l.sgst;
      totalIgst += l.igst;
      totalCess += l.cess;
    }
  }
  for (const r of b2cs) {
    totalTaxable += r.taxableValue;
    totalCgst += r.cgst;
    totalSgst += r.sgst;
    totalIgst += r.igst;
    totalCess += r.cess;
    totalValue += r.taxableValue + r.cgst + r.sgst + r.igst + r.cess;
  }
  for (const n of cdnr) {
    totalValue -= n.noteValue;
    for (const l of n.lines) {
      totalTaxable -= l.taxableValue;
      totalCgst -= l.cgst;
      totalSgst -= l.sgst;
      totalIgst -= l.igst;
      totalCess -= l.cess;
    }
  }

  return {
    period: input.period,
    fp: fpCode(input.period),
    gstin: filingGstin.gstin,
    sellerState: filingGstin.state,
    generatedAt: new Date(),
    summary: {
      documentCount: b2b.length + cdnr.length,
      totalTaxableValue: round2(totalTaxable),
      totalCgst: round2(totalCgst),
      totalSgst: round2(totalSgst),
      totalIgst: round2(totalIgst),
      totalCess: round2(totalCess),
      totalInvoiceValue: round2(totalValue),
      warnings,
    },
    b2b,
    b2cs,
    cdnr,
    hsn,
  };
}

/** Resolve which CompanyGSTIN we're filing for. If `requested` is set we
 *  match by GSTIN exactly; else we use the active primary. Returns the
 *  GSTIN + the state it's registered in (drives Place of Supply math). */
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
  if (!primary) throw new Error("No active CompanyGSTIN found — set one up under Settings → Company Profile.");
  return { gstin: primary.gstin, state: primary.state };
}

// ─── GST portal JSON shape ────────────────────────────────────────────
//
// The official format is a deeply nested JSON the offline GSTR-1 tool
// imports. We emit a *minimal* version that covers Sections 4A, 7, 9B,
// and 12. Sections 5A, 6A, 9C, 13 are intentionally omitted (Phase 2).

export function gstr1ToPortalJson(r: GSTR1Report): unknown {
  // Group B2B invoices by customer GSTIN (ctin) as the portal expects.
  const b2bByCtin = new Map<string, GSTR1B2BInvoice[]>();
  for (const inv of r.b2b) {
    const arr = b2bByCtin.get(inv.customerGstin) ?? [];
    arr.push(inv);
    b2bByCtin.set(inv.customerGstin, arr);
  }
  const cdnrByCtin = new Map<string, GSTR1CDNRNote[]>();
  for (const n of r.cdnr) {
    const arr = cdnrByCtin.get(n.customerGstin) ?? [];
    arr.push(n);
    cdnrByCtin.set(n.customerGstin, arr);
  }

  return {
    gstin: r.gstin,
    fp: r.fp,
    version: "GST3.0.4",
    hash: "hash",
    b2b: Array.from(b2bByCtin.entries()).map(([ctin, invs]) => ({
      ctin,
      inv: invs.map((i) => ({
        inum: i.invoiceNo,
        idt: formatPortalDate(i.invoiceDate),
        val: round2(i.invoiceValue),
        pos: i.posCode,
        rchrg: i.reverseCharge ? "Y" : "N",
        inv_typ: i.invoiceType,
        itms: i.lines.map((l, idx) => ({
          num: idx + 1,
          itm_det: {
            txval: round2(l.taxableValue),
            rt: round2(l.rate),
            iamt: round2(l.igst),
            camt: round2(l.cgst),
            samt: round2(l.sgst),
            csamt: round2(l.cess),
          },
        })),
      })),
    })),
    b2cs: r.b2cs.map((b) => ({
      sply_ty: b.posCode === getGstStateCode(r.sellerState) ? "INTRA" : "INTER",
      pos: b.posCode,
      typ: b.type,
      txval: round2(b.taxableValue),
      rt: round2(b.rate),
      iamt: round2(b.igst),
      camt: round2(b.cgst),
      samt: round2(b.sgst),
      csamt: round2(b.cess),
    })),
    cdnr: Array.from(cdnrByCtin.entries()).map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: n.noteType,
        nt_num: n.noteNo,
        nt_dt: formatPortalDate(n.noteDate),
        p_gst: "N",
        rsn: "01",
        val: round2(n.noteValue),
        pos: n.posCode,
        rchrg: n.reverseCharge ? "Y" : "N",
        inv_typ: "R",
        itms: n.lines.map((l, idx) => ({
          num: idx + 1,
          itm_det: {
            txval: round2(l.taxableValue),
            rt: round2(l.rate),
            iamt: round2(l.igst),
            camt: round2(l.cgst),
            samt: round2(l.sgst),
            csamt: round2(l.cess),
          },
        })),
      })),
    })),
    hsn: {
      data: r.hsn.map((h, idx) => ({
        num: idx + 1,
        hsn_sc: h.hsn,
        desc: h.description ?? "",
        uqc: h.uqc,
        qty: round2(h.totalQty),
        rt: round2(h.rate),
        txval: round2(h.taxableValue),
        iamt: round2(h.igst),
        camt: round2(h.cgst),
        samt: round2(h.sgst),
        csamt: round2(h.cess),
      })),
    },
  };
}

function formatPortalDate(d: Date): string {
  // GST portal format: DD-MM-YYYY
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}
