import { prisma } from "@/lib/db";
import { addDays } from "@/lib/date";
import { env } from "@/lib/env";

export type LedgerEntry = {
  date: Date;
  /** Model code (FTV/OR/…) or null for vendor-level rows (e.g. Other Charges). */
  model: string | null;
  type: string; // "Purchase" | "Return to Vendor" | "Sales" | "Payment" | "Other Charge"
  docNo: string;
  label: string;
  debit: number;
  credit: number;
  /** Due date for OR (ON_GRN) purchase credits. */
  dueDate: Date | null;
  /** GRN id for drill-down on Purchase / Return-to-Vendor rows; null otherwise. */
  refId: string | null;
};

export type ModelPresence = { code: string; basis: string };

export type VendorLedger = {
  entries: LedgerEntry[]; // sorted by date; no running balance (caller adds per active filter)
  byModel: Record<string, { credit: number; debit: number; balance: number; basis: string }>;
  combined: { totalDebit: number; totalCredit: number; balance: number };
  modelsPresent: ModelPresence[];
  tiles: { ftvPayable: number; orPayable: number; orOverdue: number; monthFtvSales: number };
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type ModelCfg = { basis: string; term: number };

/** Resolver for a model's payment basis + term, with a sensible legacy fallback. */
export async function loadModelBasis(): Promise<(model: string | null) => ModelCfg> {
  const masters = await prisma.modelMaster.findMany({
    select: { code: true, paymentBasis: true, paymentTermDays: true },
  });
  const cfg = new Map(masters.map((m) => [m.code, { basis: m.paymentBasis, term: m.paymentTermDays }]));
  return (model: string | null): ModelCfg => {
    if (!model) return { basis: "ON_SALE", term: 0 };
    const c = cfg.get(model);
    if (c) return c;
    return model === "OR" ? { basis: "ON_GRN", term: 45 } : { basis: "ON_SALE", term: 0 };
  };
}

/**
 * Builds a model-aware vendor ledger — legal "complete account" view.
 *
 * Every GRN posts to the ledger irrespective of model (credit on PURCHASE/RFV,
 * debit on RTV). The difference between OR and FTV is only the due date:
 *  - ON_GRN (OR): credit due at grnDate + termDays.
 *  - ON_SALE (FTV / FTV_NORETURN): credit has no due date; settles by sale-
 *    triggered payments and by RTV when stock goes stale. To keep cut-over
 *    clean (Q2 locked: only new GRNs from today onwards), FTV GRNs only post
 *    when grnDate >= env.FTV_LEDGER_CUTOVER_DATE.
 *
 * Sales no longer post to the ledger (Q1 locked: hide entirely). Sales remain
 * the source of the "due now" (sold-uncovered) suggestion on the FTV Payment
 * screen, computed separately — they're not accounting events on the vendor's
 * own book.
 */
export async function buildVendorLedger(vendorId: string): Promise<VendorLedger> {
  const basisOf = await loadModelBasis();

  const [grnLines, sales, payments, orPayments, charges, openings] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { grn: { vendorId, isDraft: false } },
      select: { model: true, totalValue: true, grn: { select: { id: true, grnNo: true, grnDate: true, type: true, isOpening: true, openingPaid: true } } },
    }),
    prisma.sale.findMany({
      where: { vendorId },
      select: { model: true, qtySold: true, qtyReturn: true, qtyRTO: true, unitRate: true, taxRate: true, vchDate: true },
    }),
    prisma.payment.findMany({
      where: { vendorId, amountPaid: { gt: 0 } },
      select: { model: true, amountPaid: true, paidOn: true, createdAt: true, month: true, utr: true },
    }),
    prisma.orPayment.findMany({
      where: { vendorId },
      select: { voucherNo: true, date: true, amount: true, reference: true, particulars: true },
    }),
    prisma.otherCharge.findMany({
      where: { vendorId },
      select: { chargeNo: true, date: true, reason: true, total: true, direction: true, model: true },
    }),
    prisma.vendorOpeningBalance.findMany({
      where: { vendorId },
      select: { model: true, amount: true, drCr: true, asOf: true },
    }),
  ]);

  const entries: LedgerEntry[] = [];

  // Imported per-model opening balances (independent of inventory). CR = we owe
  // the vendor. Dated to as-of so they sort to the top of the running balance.
  for (const ob of openings) {
    entries.push({
      date: ob.asOf, model: ob.model, type: "Opening Balance", docNo: "OPENING", label: "Opening balance",
      debit: ob.drCr === "DR" ? ob.amount : 0,
      credit: ob.drCr === "CR" ? ob.amount : 0,
      dueDate: null, refId: null,
    });
  }

  // GRN → every model posts to the ledger now. Aggregate per (GRN, model).
  // ON_GRN credits get a due date (grnDate + term); ON_SALE credits have none
  // and are gated by the cut-over date so we don't retroactively materialise
  // legacy FTV liabilities.
  const cutover = new Date(`${env.FTV_LEDGER_CUTOVER_DATE}T00:00:00.000Z`);
  const grnAgg = new Map<string, { grnId: string; grnNo: string; date: Date; type: string; model: string; basis: string; total: number; term: number }>();
  for (const l of grnLines) {
    if (!l.model) continue;
    // Paid opening stock is already settled (funded by Opening Balance Equity) —
    // it's never a vendor payable. Pending opening still credits the vendor.
    if (l.grn.isOpening && l.grn.openingPaid) continue;
    const b = basisOf(l.model);
    // Opening GRNs always post (bypass the FTV ON_SALE cut-over gate, which only
    // exists to avoid materialising legacy live-purchase liabilities).
    if (b.basis === "ON_SALE" && !l.grn.isOpening && l.grn.grnDate < cutover) continue;
    const key = `${l.grn.grnNo}|${l.model}`;
    const e = grnAgg.get(key) ?? { grnId: l.grn.id, grnNo: l.grn.grnNo, date: l.grn.grnDate, type: l.grn.type, model: l.model, basis: b.basis, total: 0, term: b.term };
    e.total += l.totalValue;
    grnAgg.set(key, e);
  }
  for (const g of grnAgg.values()) {
    if (g.type === "RTV") {
      entries.push({ date: g.date, model: g.model, type: "Return to Vendor", docNo: g.grnNo, label: "Goods returned", debit: g.total, credit: 0, dueDate: null, refId: g.grnId });
    } else {
      // PURCHASE or RFV (Reject-In) → credit the vendor.
      // OR credits have a due date (grnDate + termDays); FTV credits don't —
      // they settle by sale-driven payments or by an RTV when stock goes stale.
      entries.push({
        date: g.date, model: g.model,
        type: g.type === "RFV" ? "Reject-In" : "Purchase",
        docNo: g.grnNo,
        label: g.type === "RFV" ? "Goods re-received" : "Goods received",
        debit: 0, credit: g.total,
        dueDate: g.basis === "ON_GRN" ? addDays(g.date, g.term) : null,
        refId: g.grnId,
      });
    }
  }

  // Sales no longer post to the ledger (Q1 locked: hide entirely). Sales are
  // an internal stock movement, not a vendor-side accounting event.

  // FTV/consignment payments come from the month-based Payment table (ON_SALE only).
  for (const p of payments) {
    if (basisOf(p.model).basis !== "ON_SALE") continue;
    entries.push({ date: p.paidOn ?? p.createdAt, model: p.model, type: "Payment", docNo: p.utr ?? "—", label: p.month, debit: p.amountPaid, credit: 0, dueDate: null, refId: null });
  }

  // OR payments are free-form vouchers; tag them to the vendor's ON_GRN model.
  // Pick the first model on this vendor whose basis is ON_GRN (grnAgg now
  // contains every model, so the older "first row" trick no longer works).
  const orModel = [...grnAgg.values()].find((g) => g.basis === "ON_GRN")?.model ?? null;
  for (const op of orPayments) {
    entries.push({ date: op.date, model: orModel, type: "Payment", docNo: op.voucherNo ?? op.reference ?? "—", label: op.particulars ?? "OR payment", debit: op.amount, credit: 0, dueDate: null, refId: null });
  }

  // Debit / Credit notes → debit reduces what we owe, credit increases it. Tagged to model.
  for (const c of charges) {
    const isCredit = c.direction === "CREDIT";
    entries.push({
      date: c.date, model: c.model, type: isCredit ? "Credit Note" : "Debit Note",
      docNo: c.chargeNo, label: c.reason,
      debit: isCredit ? 0 : c.total, credit: isCredit ? c.total : 0, dueDate: null, refId: null,
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  const byModel: Record<string, { credit: number; debit: number; balance: number; basis: string }> = {};
  for (const e of entries) {
    const key = e.model ?? "—";
    const m = byModel[key] ?? { credit: 0, debit: 0, balance: 0, basis: e.model ? basisOf(e.model).basis : "—" };
    m.credit += e.credit;
    m.debit += e.debit;
    m.balance = m.credit - m.debit;
    byModel[key] = m;
  }

  const combined = {
    totalDebit: entries.reduce((s, e) => s + e.debit, 0),
    totalCredit: entries.reduce((s, e) => s + e.credit, 0),
    balance: entries.reduce((s, e) => s + e.credit - e.debit, 0),
  };

  // Tiles
  let ftvPayable = 0;
  let orPayable = 0;
  for (const [code, m] of Object.entries(byModel)) {
    if (code === "—") continue;
    if (m.basis === "ON_GRN") orPayable += m.balance;
    else ftvPayable += m.balance;
  }

  const today = new Date();
  let pastDueOR = 0;
  let orDebit = 0;
  for (const e of entries) {
    if (!e.model || basisOf(e.model).basis !== "ON_GRN") continue;
    if (e.credit > 0 && e.dueDate && e.dueDate < today) pastDueOR += e.credit;
    orDebit += e.debit;
  }
  const orOverdue = Math.max(0, pastDueOR - orDebit);

  // Sales tile derives straight from Sale rows now (sales no longer post to the
  // ledger). Same net-incl-GST formula as the legacy ledger entry used to use.
  const thisMonth = monthKey(today);
  let monthFtvSales = 0;
  for (const s of sales) {
    if (basisOf(s.model).basis !== "ON_SALE" || !s.model) continue;
    if (monthKey(s.vchDate) !== thisMonth) continue;
    const net = s.qtySold - s.qtyReturn - s.qtyRTO;
    monthFtvSales += net * s.unitRate * (1 + s.taxRate / 100);
  }

  const modelsPresent: ModelPresence[] = Object.entries(byModel)
    .filter(([code]) => code !== "—")
    .map(([code, m]) => ({ code, basis: m.basis }));

  return { entries, byModel, combined, modelsPresent, tiles: { ftvPayable, orPayable, orOverdue, monthFtvSales } };
}
