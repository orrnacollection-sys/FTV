/**
 * GSTR-2B ↔ GRN reconciliation (#132 — GST Phase 3).
 *
 * The portal-side workflow:
 *   1. Admin downloads GSTR-2B from gst.gov.in for the period (JSON or
 *      tabular CSV — the "B2B" worksheet from the offline tool's
 *      Excel export.)
 *   2. parseGSTR2B(text, kind) creates GSTR2BLine rows (UNMATCHED).
 *   3. findItcMatches() scans for GRNs whose vendor GSTIN + invoice
 *      number + amount line up with each line.
 *   4. applyItcMatches() links matched pairs (sets GRN.matchedItc2bLineId).
 *   5. Eligible ITC = sum of MATCHED 2B lines tax. Unmatched-in-books
 *      = "vendor reported it, you forgot to record" → likely a missing
 *      GRN. Unmatched-in-portal = "you posted, vendor hasn't filed yet"
 *      → reach out to vendor.
 */
import { prisma } from "@/lib/db";
import { parse as parseCsv } from "papaparse";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── 2B JSON parsing ─────────────────────────────────────────────────

export type Parsed2BLine = {
  vendorGstin: string;
  vendorName: string | null;
  invoiceNo: string;
  invoiceDate: Date;
  invoiceType: string;
  invoiceValue: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  placeOfSupply: string | null;
  reverseCharge: boolean;
};

/** Parse the portal's GSTR-2B JSON. Covers the b2b section (regular
 *  invoices); CDNR (credit/debit notes) and other sections deferred. */
export function parseGSTR2BJson(text: string): { period: string; filingGstin: string; lines: Parsed2BLine[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Bad JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const root = raw as Record<string, unknown>;
  // Portal wraps the payload in a `data` envelope; older exports skip it.
  const data = (root["data"] ?? root) as Record<string, unknown>;
  const fp = String(data["fp"] ?? data["return_period"] ?? "");
  const gstin = String(data["gstin"] ?? "");
  if (!fp || !gstin) throw new Error("Missing fp / gstin in 2B JSON");

  // fp is MMYYYY on the portal; convert to YYYY-MM.
  const mm = fp.slice(0, 2);
  const yyyy = fp.slice(2);
  const period = `${yyyy}-${mm}`;

  const lines: Parsed2BLine[] = [];
  const b2b = (data["b2b"] ?? data["docdata"]) as Record<string, unknown>[] | undefined;
  if (Array.isArray(b2b)) {
    for (const supplier of b2b) {
      const ctin = String(supplier["ctin"] ?? "");
      const trdnm = supplier["trdnm"] != null ? String(supplier["trdnm"]) : null;
      const inv = supplier["inv"] as Record<string, unknown>[] | undefined;
      if (!Array.isArray(inv)) continue;
      for (const i of inv) {
        const itms = i["itms"] as Record<string, unknown>[] | undefined;
        let taxable = 0, cgst = 0, sgst = 0, igst = 0, cess = 0;
        if (Array.isArray(itms)) {
          for (const it of itms) {
            const det = (it["itm_det"] ?? it) as Record<string, unknown>;
            taxable += Number(det["txval"] ?? 0);
            cgst += Number(det["camt"] ?? 0);
            sgst += Number(det["samt"] ?? 0);
            igst += Number(det["iamt"] ?? 0);
            cess += Number(det["csamt"] ?? 0);
          }
        } else {
          // some old payloads put the tax block at invoice level
          taxable = Number(i["txval"] ?? 0);
          cgst = Number(i["camt"] ?? 0);
          sgst = Number(i["samt"] ?? 0);
          igst = Number(i["iamt"] ?? 0);
          cess = Number(i["csamt"] ?? 0);
        }
        const invDateStr = String(i["idt"] ?? "");
        const invoiceDate = parsePortalDate(invDateStr);
        if (!invoiceDate) continue;
        lines.push({
          vendorGstin: ctin,
          vendorName: trdnm,
          invoiceNo: String(i["inum"] ?? ""),
          invoiceDate,
          invoiceType: String(i["inv_typ"] ?? "R"),
          invoiceValue: Number(i["val"] ?? 0),
          taxableValue: round2(taxable),
          cgst: round2(cgst),
          sgst: round2(sgst),
          igst: round2(igst),
          cess: round2(cess),
          placeOfSupply: i["pos"] != null ? String(i["pos"]) : null,
          reverseCharge: String(i["rchrg"] ?? "N") === "Y",
        });
      }
    }
  }

  return { period, filingGstin: gstin, lines };
}

/** Parse a tabular CSV — the offline tool's B2B worksheet shape (or any
 *  CSV with similar columns). Caller passes the period + filing GSTIN
 *  manually since CSV doesn't usually carry the wrapper metadata. */
export function parseGSTR2BCsv(text: string): {
  lines: Parsed2BLine[];
  errors: string[];
} {
  const parsed = parseCsv<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { lines: [], errors: [`CSV parse failed: ${parsed.errors[0].message}`] };
  }
  const headers = parsed.meta.fields ?? [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = new Map(headers.map((h) => [norm(h), h]));
  function pick(...cands: string[]): string | null {
    for (const c of cands) { const got = map.get(c); if (got) return got; }
    return null;
  }
  const gstinCol = pick("gstinofsupplier", "vendorgstin", "ctin", "gstin");
  const nameCol = pick("tradetradename", "vendorname", "tradename", "supplier");
  const invCol = pick("invoicenumber", "invoiceno", "inum");
  const invDateCol = pick("invoicedate", "idt");
  const invValCol = pick("invoicevalue", "val");
  const taxableCol = pick("taxablevalue", "txval", "taxable");
  const cgstCol = pick("centraltaxamount", "cgst", "camt");
  const sgstCol = pick("stateunionterritorytaxamount", "sgst", "samt");
  const igstCol = pick("integratedtaxamount", "igst", "iamt");
  const cessCol = pick("cessamount", "cess", "csamt");
  const posCol = pick("placeofsupply", "pos");
  const typeCol = pick("invoicetype", "inv_typ");
  const rchgCol = pick("reversecharge", "rchrg");

  if (!gstinCol || !invCol || !invDateCol) {
    return { lines: [], errors: [`Missing required column — need GSTIN of Supplier, Invoice Number, Invoice Date`] };
  }

  const lines: Parsed2BLine[] = [];
  const errors: string[] = [];
  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const rl = `row ${i + 2}`;
    const invDate = parseFlexibleDateLocal(r[invDateCol] ?? "");
    if (!invDate) { errors.push(`${rl}: bad date "${r[invDateCol]}"`); continue; }
    const num = (col: string | null) => col ? Number(stripCommas(r[col] ?? "0")) || 0 : 0;
    lines.push({
      vendorGstin: String(r[gstinCol] ?? "").trim(),
      vendorName: nameCol ? String(r[nameCol] ?? "").trim() || null : null,
      invoiceNo: String(r[invCol] ?? "").trim(),
      invoiceDate: invDate,
      invoiceType: typeCol ? String(r[typeCol] ?? "R").trim() || "R" : "R",
      invoiceValue: round2(num(invValCol)),
      taxableValue: round2(num(taxableCol)),
      cgst: round2(num(cgstCol)),
      sgst: round2(num(sgstCol)),
      igst: round2(num(igstCol)),
      cess: round2(num(cessCol)),
      placeOfSupply: posCol ? String(r[posCol] ?? "").trim() || null : null,
      reverseCharge: rchgCol ? String(r[rchgCol] ?? "").trim().toUpperCase().startsWith("Y") : false,
    });
  }
  return { lines, errors };
}

function parsePortalDate(s: string): Date | null {
  // "DD-MM-YYYY" portal format
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

function parseFlexibleDateLocal(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  // DD-MM-YYYY or DD/MM/YYYY
  const m1 = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(t);
  if (m1) return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]));
  // YYYY-MM-DD
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function stripCommas(s: string): string {
  return (s ?? "").toString().replace(/,/g, "").trim();
}

// ── Auto-match ──────────────────────────────────────────────────────

export type ItcMatchProposal = {
  lineId: string;
  grnId: string;
  score: number;
  reason: string;
};

export type ItcAutoMatchResult = {
  proposalCount: number;
  proposals: ItcMatchProposal[];
  unmatchedLineIds: string[];
};

/** Find GRN candidates for every UNMATCHED 2B line.
 *  Match rules (strict — ITC is regulated):
 *    1. Vendor GSTIN must match exactly (lower bar removed — IRP enforces).
 *    2. Invoice number must match after normalization (strip /-/spaces/case).
 *    3. Total tax within ±₹1 of the line.
 *  Ref bonus: portal value vs grn total within ±₹1 boosts score. */
export async function findItcMatches(input: {
  filingGstin: string;
  period: string;
}): Promise<ItcAutoMatchResult> {
  const lines = await prisma.gSTR2BLine.findMany({
    where: { filingGstin: input.filingGstin, period: input.period, matchStatus: "UNMATCHED" },
  });

  // Unmatched GRNs (PURCHASE only — RTV/RFV are vendor returns, not ITC).
  const grns = await prisma.gRN.findMany({
    where: {
      matchedItc2bLineId: null,
      isDraft: false,
      type: "PURCHASE",
      vendor: { gstRegType: "REGULAR" },
    },
    include: {
      vendor: { select: { gst: true, name: true } },
      items: { select: { tax: true } },
    },
  });

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Bucket GRNs by (vendorGstin, normalized invoice).
  const bucket = new Map<string, typeof grns>();
  for (const g of grns) {
    if (!g.vendor.gst) continue;
    const key = `${g.vendor.gst}|${norm(g.vendorInvoiceNo ?? "")}`;
    const arr = bucket.get(key) ?? [];
    arr.push(g);
    bucket.set(key, arr);
  }

  const taken = new Set<string>();
  const proposals: ItcMatchProposal[] = [];
  const unmatchedLineIds: string[] = [];

  for (const line of lines) {
    const key = `${line.vendorGstin}|${norm(line.invoiceNo)}`;
    const candidates = bucket.get(key) ?? [];
    let best: { grn: typeof grns[number]; score: number; reason: string } | null = null;
    for (const g of candidates) {
      if (taken.has(g.id)) continue;
      const grnTax = g.items.reduce((s, it) => s + it.tax, 0);
      const lineTax = line.cgst + line.sgst + line.igst + line.cess;
      const taxDiff = Math.abs(round2(grnTax) - round2(lineTax));
      if (taxDiff > 1) continue;
      let score = taxDiff;
      let reason = `inv ${line.invoiceNo} · Δ₹${taxDiff.toFixed(2)} tax`;
      const valDiff = Math.abs(round2(g.total) - round2(line.invoiceValue));
      if (valDiff < 1) {
        score -= 1;
        reason += " · total exact";
      }
      if (!best || score < best.score) best = { grn: g, score, reason };
    }
    if (best) {
      proposals.push({ lineId: line.id, grnId: best.grn.id, score: best.score, reason: best.reason });
      taken.add(best.grn.id);
    } else {
      unmatchedLineIds.push(line.id);
    }
  }

  return { proposalCount: proposals.length, proposals, unmatchedLineIds };
}

export async function applyItcMatches(proposals: ItcMatchProposal[], by: string): Promise<{ matched: number; errors: string[] }> {
  const errors: string[] = [];
  let matched = 0;
  for (const p of proposals) {
    try {
      await prisma.$transaction(async (tx) => {
        const line = await tx.gSTR2BLine.findUnique({ where: { id: p.lineId }, select: { matchStatus: true } });
        const grn = await tx.gRN.findUnique({ where: { id: p.grnId }, select: { matchedItc2bLineId: true } });
        if (!line || !grn) throw new Error("row missing");
        if (line.matchStatus !== "UNMATCHED") throw new Error("line not unmatched");
        if (grn.matchedItc2bLineId) throw new Error("grn already matched");

        await tx.gSTR2BLine.update({
          where: { id: p.lineId },
          data: { matchStatus: "MATCHED", matchedAt: new Date(), matchedBy: by },
        });
        await tx.gRN.update({
          where: { id: p.grnId },
          data: { matchedItc2bLineId: p.lineId },
        });
      });
      matched++;
    } catch (e) {
      errors.push(`${p.lineId.slice(-6)}/${p.grnId.slice(-6)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { matched, errors };
}

// ── Summary ─────────────────────────────────────────────────────────

export type ItcSummary = {
  total2BLines: number;
  totalGrns: number;
  matched: number;
  unmatchedLines: number;
  unmatchedGrns: number;
  ignoredLines: number;
  /** Sum of CGST+SGST+IGST+CESS across MATCHED 2B lines — claimable. */
  eligibleItcTax: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  /** GRN-side tax for matched-only — should equal the line side (±tolerance). */
  bookItcTaxMatched: number;
  /** GRN-side tax for everything (matched + unmatched) — what's in GSTR-3B 4(A5). */
  bookItcTaxAll: number;
  /** Difference = at-risk amount (book claim − portal evidence). */
  atRiskTax: number;
};

export async function getItcSummary(input: { filingGstin: string; period: string; from: Date; to: Date }): Promise<ItcSummary> {
  const lines = await prisma.gSTR2BLine.findMany({
    where: { filingGstin: input.filingGstin, period: input.period },
    select: { matchStatus: true, cgst: true, sgst: true, igst: true, cess: true },
  });
  const eligible = { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  let unmatchedLines = 0, matched = 0, ignored = 0;
  for (const l of lines) {
    if (l.matchStatus === "MATCHED") {
      eligible.cgst += l.cgst;
      eligible.sgst += l.sgst;
      eligible.igst += l.igst;
      eligible.cess += l.cess;
      matched++;
    } else if (l.matchStatus === "UNMATCHED") unmatchedLines++;
    else if (l.matchStatus === "IGNORED") ignored++;
  }
  eligible.total = round2(eligible.cgst + eligible.sgst + eligible.igst + eligible.cess);

  const grns = await prisma.gRN.findMany({
    where: {
      grnDate: { gte: input.from, lt: input.to },
      isDraft: false,
      type: "PURCHASE",
      vendor: { gstRegType: "REGULAR" },
    },
    select: { matchedItc2bLineId: true, items: { select: { tax: true } } },
  });
  let bookMatched = 0, bookAll = 0, unmatchedGrns = 0;
  for (const g of grns) {
    const tx = g.items.reduce((s, it) => s + it.tax, 0);
    bookAll += tx;
    if (g.matchedItc2bLineId) bookMatched += tx;
    else unmatchedGrns++;
  }

  return {
    total2BLines: lines.length,
    totalGrns: grns.length,
    matched,
    unmatchedLines,
    unmatchedGrns,
    ignoredLines: ignored,
    eligibleItcTax: {
      cgst: round2(eligible.cgst),
      sgst: round2(eligible.sgst),
      igst: round2(eligible.igst),
      cess: round2(eligible.cess),
      total: eligible.total,
    },
    bookItcTaxMatched: round2(bookMatched),
    bookItcTaxAll: round2(bookAll),
    atRiskTax: round2(bookAll - bookMatched),
  };
}
