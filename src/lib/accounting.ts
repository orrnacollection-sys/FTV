/**
 * Accounting Engine — Phase 1 helpers (#125).
 *
 * Public surface:
 *   - createJournalEntry(input)         — manual or auto-posted entry
 *   - ensureCustomerCoA(customerId)     — idempotent sub-ledger create
 *   - ensureVendorCoA(vendorId)         — idempotent sub-ledger create
 *   - getTrialBalance({ asOf })         — { account, debit, credit, balance }[]
 *   - getProfitAndLoss({ from, to })    — { income, expense, netProfit, lines[] }
 *   - getBalanceSheet({ asOf })         — { assets, liabilities, equity, … }
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextDocNumber } from "@/lib/series";
import { getActiveCompanyId } from "@/lib/company";

// ── Constants ─────────────────────────────────────────────────────────────

export const SUNDRY_DEBTORS_CODE = "1130";
export const SUNDRY_CREDITORS_CODE = "2110";
export const RETAINED_EARNINGS_CODE = "3200";
export const INVENTORY_CODE = "1140";
export const GST_PAYABLE_CODE = "2120";
export const CASH_CODE = "1110";
export const BANK_PARENT_CODE = "1120";
export const BANK_CHARGES_CODE = "5280";
export const INTEREST_INCOME_CODE = "4210";
export const MISC_INCOME_CODE = "4220";
export const MISC_EXPENSE_CODE = "5300";

/** Pick the right Sales account based on Order channel + product model.
 *  Falls back to "Sales — Direct" if neither matches a seeded code. */
const SALES_BY_CHANNEL: Record<string, string> = {
  MARKETPLACE: "4110",  // FTV/OR auto-split happens via item.vendor.model later
  DIRECT: "4130",
  WEBSITE: "4130",
  LEGACY: "4130",
};

export type AccountType = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";

/** Debit-balance accounts have a positive balance shown when debits exceed
 *  credits. Credit-balance accounts are the opposite. Drives Trial Balance
 *  sign + Balance Sheet aggregation. */
function isDebitBalance(type: string): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

/** Convert a magnitude + Dr/Cr into the stored opening balance, which is
 *  positive on the account's natural side (debit-positive for Asset/Expense,
 *  credit-positive for Liability/Income/Equity). So a Dr opening on an asset is
 *  +amount, while a Dr opening on a liability is −amount. */
export function signedOpening(type: string, amount: number, drCr: "DR" | "CR"): number {
  const amt = Math.abs(Number(amount) || 0);
  const naturalDr = isDebitBalance(type);
  return (drCr === "DR") === naturalDr ? amt : -amt;
}

/** Set the opening balance on a master's CoA sub-ledger (vendor / customer). */
export async function setSubLedgerOpening(accountId: string, openingBalance: number): Promise<void> {
  await prisma.chartOfAccount.update({ where: { id: accountId }, data: { openingBalance } });
}

// ── Journal Entry create ──────────────────────────────────────────────────

export type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  narration?: string;
};

export type JournalEntryInput = {
  date: Date;
  narration?: string;
  lines: JournalLineInput[];
  source?: string;        // MANUAL by default
  sourceRefId?: string;
  createdBy?: string;
};

export type CreateJournalResult =
  | { ok: true; id: string; voucherNo: string }
  | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Validate + create a JournalEntry with its lines in one transaction.
 *  Each line must carry either debit OR credit (not both, not neither);
 *  sum of debits must equal sum of credits. */
export async function createJournalEntry(input: JournalEntryInput): Promise<CreateJournalResult> {
  if (input.lines.length < 2) {
    return { ok: false, error: "A journal entry needs at least 2 lines (Dr + Cr)" };
  }
  let totalDr = 0;
  let totalCr = 0;
  for (const line of input.lines) {
    const dr = round2(line.debit ?? 0);
    const cr = round2(line.credit ?? 0);
    if (dr === 0 && cr === 0) return { ok: false, error: "Every line needs a non-zero debit or credit" };
    if (dr > 0 && cr > 0) return { ok: false, error: "A line can't carry both debit AND credit" };
    if (dr < 0 || cr < 0) return { ok: false, error: "Amounts must be positive" };
    totalDr += dr;
    totalCr += cr;
  }
  if (round2(totalDr) !== round2(totalCr)) {
    return { ok: false, error: `Entry unbalanced — debits ₹${round2(totalDr)} ≠ credits ₹${round2(totalCr)}` };
  }

  try {
    const companyId = await getActiveCompanyId();
    const result = await prisma.$transaction(async (tx) => {
      const voucherNo = await nextDocNumber("JV", tx);
      const entry = await tx.journalEntry.create({
        data: {
          voucherNo,
          date: input.date,
          narration: input.narration ?? null,
          source: input.source ?? "MANUAL",
          sourceRefId: input.sourceRefId ?? null,
          createdBy: input.createdBy ?? null,
          companyId,
          lines: {
            create: input.lines.map((l) => ({
              accountId: l.accountId,
              debit: round2(l.debit ?? 0),
              credit: round2(l.credit ?? 0),
              narration: l.narration ?? null,
            })),
          },
        },
        select: { id: true, voucherNo: true },
      });
      return entry;
    });
    return { ok: true, id: result.id, voucherNo: result.voucherNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to post entry" };
  }
}

/** Edit a MANUAL journal entry in place — re-validate the balance and replace
 *  its lines (the postings), keeping the original voucher number. Auto-posted
 *  entries are immutable here: undo them at their source document instead. */
export async function updateJournalEntry(input: {
  id: string;
  date: Date;
  narration?: string;
  lines: JournalLineInput[];
}): Promise<CreateJournalResult> {
  if (input.lines.length < 2) {
    return { ok: false, error: "A journal entry needs at least 2 lines (Dr + Cr)" };
  }
  let totalDr = 0;
  let totalCr = 0;
  for (const line of input.lines) {
    const dr = round2(line.debit ?? 0);
    const cr = round2(line.credit ?? 0);
    if (dr === 0 && cr === 0) return { ok: false, error: "Every line needs a non-zero debit or credit" };
    if (dr > 0 && cr > 0) return { ok: false, error: "A line can't carry both debit AND credit" };
    if (dr < 0 || cr < 0) return { ok: false, error: "Amounts must be positive" };
    totalDr += dr;
    totalCr += cr;
  }
  if (round2(totalDr) !== round2(totalCr)) {
    return { ok: false, error: `Entry unbalanced — debits ₹${round2(totalDr)} ≠ credits ₹${round2(totalCr)}` };
  }

  const existing = await prisma.journalEntry.findUnique({
    where: { id: input.id },
    select: { voucherNo: true, source: true },
  });
  if (!existing) return { ok: false, error: "Entry not found" };
  if (existing.source !== "MANUAL") {
    return { ok: false, error: `Cannot edit a ${existing.source} entry — undo it at the source instead.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { entryId: input.id } });
      await tx.journalEntry.update({
        where: { id: input.id },
        data: {
          date: input.date,
          narration: input.narration ?? null,
          lines: {
            create: input.lines.map((l) => ({
              accountId: l.accountId,
              debit: round2(l.debit ?? 0),
              credit: round2(l.credit ?? 0),
              narration: l.narration ?? null,
            })),
          },
        },
      });
    });
    return { ok: true, id: input.id, voucherNo: existing.voucherNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update entry" };
  }
}

// ── Auto-create sub-ledger when Customer / Vendor is created ──────────────

/** Next sequential child code under a parent — "1130" → "1130-001", "-002"…
 *  Scoped to the active company so each company has its own -001 / -002.
 *  Codes are Tally-clean across companies thanks to the composite
 *  `@@unique([companyId, code])` on ChartOfAccount (#135). */
async function nextChildCode(parentCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const companyId = await getActiveCompanyId();
  const prefix = `${parentCode}-`;
  const last = await tx.chartOfAccount.findFirst({
    where: {
      companyId,
      code: { startsWith: prefix },
    },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const lastNum = last?.code ? Number(last.code.slice(prefix.length)) : 0;
  const next = (lastNum || 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/** Idempotent — creates a CoA sub-ledger under Sundry Debtors (1130) for
 *  the customer if one doesn't already exist. Re-running is a no-op. */
export async function ensureCustomerCoA(customerId: string): Promise<{ created: boolean; accountId: string } | { error: string }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, ledger: { select: { id: true } } },
  });
  if (!customer) return { error: "Customer not found" };
  if (customer.ledger) return { created: false, accountId: customer.ledger.id };

  const parentId = await accountIdByCode(SUNDRY_DEBTORS_CODE);
  if (!parentId) return { error: "Sundry Debtors parent missing — run prisma seed" };
  const parent = { id: parentId };

  const companyId = await getActiveCompanyId();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const code = await nextChildCode(SUNDRY_DEBTORS_CODE, tx);
      return tx.chartOfAccount.create({
        data: {
          code,
          name: customer.name,
          type: "ASSET",
          subType: "CURRENT_ASSET",
          parentId: parent.id,
          customerId,
          isSystem: true,
          isActive: true,
          companyId,
        },
        select: { id: true },
      });
    });
    return { created: true, accountId: result.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create CoA" };
  }
}

/** Idempotent — creates a CoA sub-ledger under Sundry Creditors (2110) for
 *  the vendor if one doesn't already exist. Re-running is a no-op. */
export async function ensureVendorCoA(vendorId: string): Promise<{ created: boolean; accountId: string } | { error: string }> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { name: true, ledger: { select: { id: true } } },
  });
  if (!vendor) return { error: "Vendor not found" };
  if (vendor.ledger) return { created: false, accountId: vendor.ledger.id };

  const parentId = await accountIdByCode(SUNDRY_CREDITORS_CODE);
  if (!parentId) return { error: "Sundry Creditors parent missing — run prisma seed" };
  const parent = { id: parentId };
  const companyId = await getActiveCompanyId();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const code = await nextChildCode(SUNDRY_CREDITORS_CODE, tx);
      return tx.chartOfAccount.create({
        data: {
          code,
          name: vendor.name,
          type: "LIABILITY",
          subType: "CURRENT_LIABILITY",
          parentId: parent.id,
          vendorId,
          isSystem: true,
          isActive: true,
          companyId,
        },
        select: { id: true },
      });
    });
    return { created: true, accountId: result.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create CoA" };
  }
}

// ── Reports ───────────────────────────────────────────────────────────────

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
  isActive: boolean;
  openingBalance: number;
  drMovement: number;
  crMovement: number;
  /** Signed balance: positive for debit-balance types, positive for credit-
   *  balance types — i.e. always shown as "how much in this account". */
  balance: number;
  /** Raw signed for math: positive Dr − positive Cr. Used to roll up to
   *  parent groups before sign flipping. */
  signedDelta: number;
};

/** Trial Balance — fetches every account with its movement totals up to
 *  `asOf` (inclusive). Returns ALL accounts (active + inactive that had
 *  any movement). Caller decides what to display.
 *
 *  Scoped to the active company (#134/#135 multi-co isolation): only
 *  rows where ChartOfAccount.companyId / JournalEntry.companyId match
 *  the active company. */
export async function getTrialBalance({ asOf }: { asOf?: Date } = {}): Promise<AccountBalance[]> {
  const companyId = await getActiveCompanyId();
  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId },
    orderBy: { code: "asc" },
  });

  const dateFilter = asOf
    ? { entry: { companyId, date: { lte: asOf } } }
    : { entry: { companyId } };
  const movements = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: dateFilter,
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(movements.map((m) => [m.accountId, m]));

  return accounts.map((a) => {
    const m = byId.get(a.id);
    const drMovement = round2(m?._sum.debit ?? 0);
    const crMovement = round2(m?._sum.credit ?? 0);
    const debitBalanced = isDebitBalance(a.type);
    // Opening + movements, with sign respecting account type
    const signedDelta = (a.openingBalance * (debitBalanced ? 1 : -1)) + drMovement - crMovement;
    const balance = debitBalanced ? signedDelta : -signedDelta;
    return {
      id: a.id,
      code: a.code ?? "",
      name: a.name,
      type: a.type,
      subType: a.subType,
      parentId: a.parentId,
      isActive: a.isActive,
      openingBalance: round2(a.openingBalance),
      drMovement,
      crMovement,
      balance: round2(balance),
      signedDelta: round2(signedDelta),
    };
  });
}

/** Condense a flat account list to group level for the financial statements:
 *  roll each auto sub-ledger (a child account carrying the "parent-NNN" dash
 *  code, e.g. 1130-001 Flipkart, 2110-002 a vendor) up into its parent group
 *  (Sundry Debtors / Sundry Creditors / Bank Accounts) and drop the child row.
 *  Balances are summed directly (so any pre-applied adjustment like Retained
 *  Earnings on a non-child row is preserved). Pure — does not hit the DB. */
export function condenseToGroups(accounts: AccountBalance[]): AccountBalance[] {
  const isChild = (a: AccountBalance) => !!a.parentId && a.code.includes("-");
  const clone = new Map(accounts.map((a) => [a.id, { ...a }]));
  for (const a of accounts) {
    if (!isChild(a)) continue;
    const parent = a.parentId ? clone.get(a.parentId) : undefined;
    if (!parent) continue;
    const child = clone.get(a.id)!;
    parent.balance = round2(parent.balance + child.balance);
    parent.signedDelta = round2(parent.signedDelta + child.signedDelta);
    parent.drMovement = round2(parent.drMovement + child.drMovement);
    parent.crMovement = round2(parent.crMovement + child.crMovement);
    parent.openingBalance = round2(parent.openingBalance + child.openingBalance);
  }
  return [...clone.values()].filter((a) => !isChild(a));
}

/** P&L for the period [from, to]. Income − Expense = Net Profit.
 *  Scoped to the active company. */
export async function getProfitAndLoss({ from, to }: { from?: Date; to?: Date } = {}) {
  const companyId = await getActiveCompanyId();
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = from;
  if (to) dateFilter.lte = to;
  const where = {
    entry: {
      companyId,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
  };

  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId, type: { in: ["INCOME", "EXPENSE"] } },
    orderBy: { code: "asc" },
  });
  const movements = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { ...where, account: { companyId, type: { in: ["INCOME", "EXPENSE"] } } },
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(movements.map((m) => [m.accountId, m]));

  const lines = accounts.map((a) => {
    const m = byId.get(a.id);
    const dr = round2(m?._sum.debit ?? 0);
    const cr = round2(m?._sum.credit ?? 0);
    // Income = credit balance is positive; Expense = debit balance is positive.
    const amount = a.type === "INCOME" ? cr - dr : dr - cr;
    return {
      id: a.id,
      code: a.code ?? "",
      name: a.name,
      type: a.type,
      subType: a.subType,
      parentId: a.parentId,
      amount: round2(amount),
    };
  });

  const income = round2(lines.filter((l) => l.type === "INCOME").reduce((s, l) => s + l.amount, 0));
  const expense = round2(lines.filter((l) => l.type === "EXPENSE").reduce((s, l) => s + l.amount, 0));
  const netProfit = round2(income - expense);

  return { income, expense, netProfit, lines };
}

/** Balance Sheet as of `asOf` (defaults to today). Retained Earnings line
 *  rolls up the lifetime Income − Expense so Assets = Liabilities + Equity
 *  even without a year-close mechanism. */
export async function getBalanceSheet({ asOf }: { asOf?: Date } = {}) {
  const tb = await getTrialBalance({ asOf });
  // Roll P&L lifetime → Retained Earnings line so the equation closes.
  const pnl = await getProfitAndLoss({ to: asOf });

  const assets = tb.filter((a) => a.type === "ASSET");
  const liabilities = tb.filter((a) => a.type === "LIABILITY");
  const equity = tb.filter((a) => a.type === "EQUITY");

  // Inject the computed retained earnings on top of any seeded Retained
  // Earnings row's stored balance. Codes are clean per company thanks to
  // the composite `@@unique([companyId, code])`.
  const reAccount = equity.find((e) => e.code === RETAINED_EARNINGS_CODE);
  if (reAccount) {
    reAccount.balance = round2(reAccount.balance + pnl.netProfit);
  }

  const totalAssets = round2(assets.reduce((s, a) => s + a.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, l) => s + l.balance, 0));
  const totalEquity = round2(equity.reduce((s, e) => s + e.balance, 0));
  const diff = round2(totalAssets - (totalLiabilities + totalEquity));

  return {
    asOf: asOf ?? new Date(),
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    /** Should be 0 if the books are clean. Any non-zero value = data bug. */
    balancingDiff: diff,
    netProfitYTD: pnl.netProfit,
  };
}

// ── Auto-post (Phase 2 — #126) ────────────────────────────────────────────

/** Resolve a logical CoA code (e.g. "1130") to the active company's
 *  account id. Each company has its own clean copy of the code thanks
 *  to the composite `@@unique([companyId, code])` on ChartOfAccount. */
const accountCache = new Map<string, string>(); // key = companyId|code
async function accountIdByCode(code: string): Promise<string | null> {
  const companyId = await getActiveCompanyId();
  const cacheKey = `${companyId}|${code}`;
  if (accountCache.has(cacheKey)) return accountCache.get(cacheKey)!;
  const a = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code } },
    select: { id: true },
  });
  if (a) accountCache.set(cacheKey, a.id);
  return a?.id ?? null;
}

async function customerLedgerId(customerId: string | null): Promise<string | null> {
  if (customerId) {
    const ca = await prisma.chartOfAccount.findUnique({ where: { customerId }, select: { id: true } });
    if (ca) return ca.id;
  }
  return accountIdByCode(SUNDRY_DEBTORS_CODE);
}

async function vendorLedgerId(vendorId: string | null): Promise<string | null> {
  if (vendorId) {
    const va = await prisma.chartOfAccount.findUnique({ where: { vendorId }, select: { id: true } });
    if (va) return va.id;
  }
  return accountIdByCode(SUNDRY_CREDITORS_CODE);
}

export async function reverseAutoJournal(source: string, sourceRefId: string): Promise<{ deleted: number }> {
  const r = await prisma.journalEntry.deleteMany({ where: { source, sourceRefId } });
  return { deleted: r.count };
}

async function hasAutoEntry(source: string, sourceRefId: string): Promise<boolean> {
  const n = await prisma.journalEntry.count({ where: { source, sourceRefId } });
  return n > 0;
}

export async function postSaleJournal(orderId: string): Promise<{ ok: true; entryId?: string; skipped?: string } | { ok: false; error: string }> {
  if (await hasAutoEntry("AUTO_SALE", orderId)) return { ok: true, skipped: "already-posted" };
  const order = await prisma.marketplaceOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, date: true, customerId: true, channel: true, type: true,
      taxableValue: true, cgst: true, sgst: true, igst: true, total: true,
      createdBy: true, marketplace: true,
    },
  });
  if (!order) return { ok: false, error: "Order not found" };
  if (round2(order.total) === 0) return { ok: true, skipped: "zero-total" };
  const debtorAccId = await customerLedgerId(order.customerId);
  const salesCode = SALES_BY_CHANNEL[order.channel] ?? "4130";
  const salesAccId = await accountIdByCode(salesCode);
  const gstAccId = await accountIdByCode(GST_PAYABLE_CODE);
  if (!debtorAccId || !salesAccId || !gstAccId) return { ok: false, error: "CoA not seeded" };
  const sign = order.type === "RETURN" || order.type === "RTO" ? -1 : 1;
  const taxable = round2(order.taxableValue * sign);
  const gst = round2((order.cgst + order.sgst + order.igst) * sign);
  const total = round2(order.total * sign);
  const lines: JournalLineInput[] = sign === 1
    ? [
        { accountId: debtorAccId, debit: total },
        ...(taxable !== 0 ? [{ accountId: salesAccId, credit: taxable }] : []),
        ...(gst !== 0 ? [{ accountId: gstAccId, credit: gst }] : []),
      ]
    : [
        { accountId: debtorAccId, credit: Math.abs(total) },
        ...(taxable !== 0 ? [{ accountId: salesAccId, debit: Math.abs(taxable) }] : []),
        ...(gst !== 0 ? [{ accountId: gstAccId, debit: Math.abs(gst) }] : []),
      ];
  const res = await createJournalEntry({
    date: order.date,
    narration: `${order.type} · ${order.marketplace}`,
    lines,
    source: "AUTO_SALE",
    sourceRefId: order.id,
    createdBy: order.createdBy ?? undefined,
  });
  if (!res.ok) return res;
  return { ok: true, entryId: res.id };
}

export async function postGRNJournal(grnId: string): Promise<{ ok: true; entryId?: string; skipped?: string } | { ok: false; error: string }> {
  if (await hasAutoEntry("AUTO_GRN", grnId)) return { ok: true, skipped: "already-posted" };
  const grn = await prisma.gRN.findUnique({
    where: { id: grnId },
    select: { id: true, grnNo: true, grnDate: true, type: true, vendorId: true, total: true, isDraft: true, createdBy: true },
  });
  if (!grn) return { ok: false, error: "GRN not found" };
  if (grn.isDraft) return { ok: true, skipped: "draft" };
  if (round2(grn.total) === 0) return { ok: true, skipped: "zero-total" };
  const inventoryAccId = await accountIdByCode(INVENTORY_CODE);
  const vendorAccId = await vendorLedgerId(grn.vendorId);
  if (!inventoryAccId || !vendorAccId) return { ok: false, error: "CoA not seeded" };
  const isReturn = grn.type === "RTV";
  const amount = round2(grn.total);
  const lines: JournalLineInput[] = isReturn
    ? [{ accountId: vendorAccId, debit: amount }, { accountId: inventoryAccId, credit: amount }]
    : [{ accountId: inventoryAccId, debit: amount }, { accountId: vendorAccId, credit: amount }];
  const res = await createJournalEntry({
    date: grn.grnDate,
    narration: `${grn.type} · ${grn.grnNo}`,
    lines,
    source: "AUTO_GRN",
    sourceRefId: grn.id,
    createdBy: grn.createdBy ?? undefined,
  });
  if (!res.ok) return res;
  return { ok: true, entryId: res.id };
}

export async function postPaymentJournal(paymentId: string): Promise<{ ok: true; entryId?: string; skipped?: string } | { ok: false; error: string }> {
  if (await hasAutoEntry("AUTO_PAYMENT", paymentId)) return { ok: true, skipped: "already-posted" };
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, vendorId: true, amountPaid: true, paidOn: true, status: true, utr: true, createdBy: true, month: true, model: true },
  });
  if (!p) return { ok: false, error: "Payment not found" };
  if (round2(p.amountPaid) === 0) return { ok: true, skipped: "zero-amount" };
  if (p.status === "PENDING") return { ok: true, skipped: "pending" };
  const vendorAccId = await vendorLedgerId(p.vendorId);
  const cashAccId = await accountIdByCode(CASH_CODE);
  if (!vendorAccId || !cashAccId) return { ok: false, error: "CoA not seeded" };
  const amount = round2(p.amountPaid);
  const lines: JournalLineInput[] = [
    { accountId: vendorAccId, debit: amount },
    { accountId: cashAccId, credit: amount },
  ];
  const res = await createJournalEntry({
    date: p.paidOn ?? new Date(),
    narration: `Vendor payment · ${p.month} · ${p.model}${p.utr ? ` · UTR ${p.utr}` : ""}`,
    lines,
    source: "AUTO_PAYMENT",
    sourceRefId: p.id,
    createdBy: p.createdBy ?? undefined,
  });
  if (!res.ok) return res;
  return { ok: true, entryId: res.id };
}

// ── Banking auto-post (#127 / #124 Phase 1) ───────────────────────────────

/** Idempotent — creates a CoA sub-ledger under Bank Accounts (1120) for
 *  the bank account if one doesn't already exist. Re-running is a no-op.
 *  Sub-ledger code is sequential: 1120-001, 1120-002, … */
export async function ensureBankCoA(bankAccountId: string): Promise<{ created: boolean; accountId: string } | { error: string }> {
  const bank = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { name: true, ledger: { select: { id: true } } },
  });
  if (!bank) return { error: "Bank account not found" };
  if (bank.ledger) return { created: false, accountId: bank.ledger.id };

  const parentId = await accountIdByCode(BANK_PARENT_CODE);
  if (!parentId) return { error: "Bank Accounts parent (1120) missing — run prisma seed" };
  const companyId = await getActiveCompanyId();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const code = await nextChildCode(BANK_PARENT_CODE, tx);
      return tx.chartOfAccount.create({
        data: {
          code,
          name: bank.name,
          type: "ASSET",
          subType: "CURRENT_ASSET",
          parentId,
          bankAccountId,
          isSystem: true,
          isActive: true,
          companyId,
        },
        select: { id: true },
      });
    });
    return { created: true, accountId: result.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create CoA" };
  }
}

async function bankLedgerId(bankAccountId: string): Promise<string | null> {
  const a = await prisma.chartOfAccount.findUnique({ where: { bankAccountId }, select: { id: true } });
  return a?.id ?? null;
}

/** Post (or skip if already posted) the JV for a BankTransaction.
 *
 *  Direction by type:
 *    RECEIPT  — Dr Bank          · Cr contraAccount (Customer / misc income)
 *    PAYMENT  — Dr contraAccount · Cr Bank          (Vendor / misc expense)
 *    CHARGE   — Dr 5280 Bank Charges  · Cr Bank
 *    INTEREST — Dr Bank · Cr 4210 Interest Income
 *    TRANSFER — Dr destination bank · Cr source bank
 *
 *  Source: AUTO_BANK_TXN, keyed by BankTransaction.id. */
export async function postBankTransactionJournal(txnId: string): Promise<{ ok: true; entryId?: string; skipped?: string } | { ok: false; error: string }> {
  if (await hasAutoEntry("AUTO_BANK_TXN", txnId)) return { ok: true, skipped: "already-posted" };
  const t = await prisma.bankTransaction.findUnique({
    where: { id: txnId },
    select: {
      id: true, date: true, type: true, amount: true, narration: true, refNo: true,
      bankAccountId: true, contraAccountId: true, contraBankAccountId: true,
      customerId: true, vendorId: true, txnNo: true, createdBy: true,
    },
  });
  if (!t) return { ok: false, error: "Bank transaction not found" };
  const amount = round2(t.amount);
  if (amount === 0) return { ok: true, skipped: "zero-amount" };

  const bankAccId = await bankLedgerId(t.bankAccountId);
  if (!bankAccId) return { ok: false, error: "Bank CoA sub-ledger missing — call ensureBankCoA first" };

  let lines: JournalLineInput[];
  if (t.type === "TRANSFER") {
    if (!t.contraBankAccountId) return { ok: false, error: "TRANSFER needs contraBankAccountId" };
    const destAccId = await bankLedgerId(t.contraBankAccountId);
    if (!destAccId) return { ok: false, error: "Destination bank CoA sub-ledger missing" };
    lines = [
      { accountId: destAccId, debit: amount },
      { accountId: bankAccId, credit: amount },
    ];
  } else {
    if (!t.contraAccountId) return { ok: false, error: "contraAccountId required (resolved at create time)" };
    if (t.type === "RECEIPT" || t.type === "INTEREST") {
      lines = [
        { accountId: bankAccId, debit: amount },
        { accountId: t.contraAccountId, credit: amount },
      ];
    } else if (t.type === "PAYMENT" || t.type === "CHARGE") {
      lines = [
        { accountId: t.contraAccountId, debit: amount },
        { accountId: bankAccId, credit: amount },
      ];
    } else {
      return { ok: false, error: `Unknown bank txn type: ${t.type}` };
    }
  }

  const res = await createJournalEntry({
    date: t.date,
    narration: `${t.type} · ${t.txnNo}${t.refNo ? ` · ${t.refNo}` : ""}${t.narration ? ` · ${t.narration}` : ""}`,
    lines,
    source: "AUTO_BANK_TXN",
    sourceRefId: t.id,
    createdBy: t.createdBy ?? undefined,
  });
  if (!res.ok) return res;
  return { ok: true, entryId: res.id };
}
