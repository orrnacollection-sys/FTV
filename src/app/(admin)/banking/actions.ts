"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import {
  bankAccountSchema,
  bankTransactionSchema,
} from "@/lib/validators/banking";
import { findAutoMatches, applyMatches } from "@/lib/reconciliation";
import { allocateReceipt as allocateReceiptHelper, removeAllocation as removeAllocationHelper } from "@/lib/allocations";
import { parse as parseCsv } from "papaparse";
import { randomUUID } from "crypto";
import {
  ensureBankCoA,
  ensureCustomerCoA,
  ensureVendorCoA,
  postBankTransactionJournal,
  reverseAutoJournal,
  BANK_CHARGES_CODE,
  INTEREST_INCOME_CODE,
  MISC_INCOME_CODE,
  MISC_EXPENSE_CODE,
} from "@/lib/accounting";
import { getActiveCompanyId } from "@/lib/company";

type Result =
  | { ok: true; id?: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(e: import("zod").ZodError) {
  return Object.fromEntries(
    Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
  );
}

// ── Bank Account CRUD ─────────────────────────────────────────────────────

function readBankForm(fd: FormData) {
  return {
    name: String(fd.get("name") ?? ""),
    bankName: String(fd.get("bankName") ?? ""),
    accountNo: String(fd.get("accountNo") ?? ""),
    ifsc: String(fd.get("ifsc") ?? ""),
    branch: String(fd.get("branch") ?? ""),
    type: String(fd.get("type") ?? "CURRENT"),
    currency: String(fd.get("currency") ?? "INR"),
    openingBalance: String(fd.get("openingBalance") ?? "0"),
    openingAsOf: String(fd.get("openingAsOf") ?? ""),
    notes: String(fd.get("notes") ?? ""),
    isActive: fd.get("isActive") ? "true" : "false",
  };
}

export async function createBankAccount(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = bankAccountSchema.safeParse(readBankForm(fd));
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const openingAsOf = parsed.data.openingAsOf ? parseFlexibleDate(parsed.data.openingAsOf) : null;
  if (parsed.data.openingAsOf && !openingAsOf) return { error: "Invalid opening date" };

  const companyId = await getActiveCompanyId();
  const bank = await prisma.bankAccount.create({
    data: {
      name: parsed.data.name,
      bankName: parsed.data.bankName,
      accountNo: parsed.data.accountNo,
      ifsc: parsed.data.ifsc ?? null,
      branch: parsed.data.branch ?? null,
      type: parsed.data.type,
      currency: parsed.data.currency,
      openingBalance: parsed.data.openingBalance,
      openingAsOf,
      notes: parsed.data.notes ?? null,
      isActive: parsed.data.isActive,
      companyId,
    },
  });
  await logWrite("BankAccount", bank.id, "CREATE", null, bank);

  // Auto-create sub-ledger under 1120 (Bank Accounts).
  const coa = await ensureBankCoA(bank.id);
  if ("error" in coa) {
    console.error(`[createBankAccount] ensureBankCoA failed for ${bank.id}: ${coa.error}`);
  }

  revalidatePath("/banking/accounts");
  revalidatePath("/accounting/chart");
  revalidatePath("/accounting/trial-balance");
  return { ok: true, id: bank.id };
}

export async function updateBankAccount(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = bankAccountSchema.safeParse(readBankForm(fd));
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const openingAsOf = parsed.data.openingAsOf ? parseFlexibleDate(parsed.data.openingAsOf) : null;
  if (parsed.data.openingAsOf && !openingAsOf) return { error: "Invalid opening date" };

  const before = await prisma.bankAccount.findUnique({ where: { id } });
  if (!before) return { error: "Bank account not found" };

  const after = await prisma.bankAccount.update({
    where: { id },
    data: {
      name: parsed.data.name,
      bankName: parsed.data.bankName,
      accountNo: parsed.data.accountNo,
      ifsc: parsed.data.ifsc ?? null,
      branch: parsed.data.branch ?? null,
      type: parsed.data.type,
      currency: parsed.data.currency,
      openingBalance: parsed.data.openingBalance,
      openingAsOf,
      notes: parsed.data.notes ?? null,
      isActive: parsed.data.isActive,
    },
  });
  // Keep the linked CoA name in sync so reports show the renamed bank.
  await prisma.chartOfAccount.updateMany({
    where: { bankAccountId: id },
    data: { name: after.name, isActive: after.isActive },
  });
  await logWrite("BankAccount", id, "UPDATE", before, after);

  revalidatePath("/banking/accounts");
  revalidatePath("/accounting/chart");
  revalidatePath("/accounting/trial-balance");
  return { ok: true };
}

export async function deleteBankAccount(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.bankAccount.findUnique({
    where: { id },
    include: { _count: { select: { txns: true, contraTxns: true } } },
  });
  if (!before) return { error: "Bank account not found" };
  if (before._count.txns + before._count.contraTxns > 0) {
    return { error: "Can't delete — this account has transactions. Mark inactive instead." };
  }
  await prisma.bankAccount.delete({ where: { id } });
  await logWrite("BankAccount", id, "DELETE", before, null);
  revalidatePath("/banking/accounts");
  revalidatePath("/accounting/chart");
  return { ok: true };
}

// ── Bank Transactions ─────────────────────────────────────────────────────

function readTxnForm(fd: FormData) {
  return {
    bankAccountId: String(fd.get("bankAccountId") ?? ""),
    date: String(fd.get("date") ?? ""),
    type: String(fd.get("type") ?? "RECEIPT"),
    amount: String(fd.get("amount") ?? "0"),
    refNo: String(fd.get("refNo") ?? ""),
    narration: String(fd.get("narration") ?? ""),
    customerId: String(fd.get("customerId") ?? ""),
    vendorId: String(fd.get("vendorId") ?? ""),
    contraBankAccountId: String(fd.get("contraBankAccountId") ?? ""),
    contraAccountCode: String(fd.get("contraAccountCode") ?? ""),
  };
}

/** Resolve the contra CoA account id from form input. Returns null for
 *  TRANSFER (handled separately by the poster), error string otherwise. */
async function resolveContraAccountId(
  input: ReturnType<typeof readTxnForm>,
): Promise<{ accountId: string | null } | { error: string }> {
  if (input.type === "TRANSFER") return { accountId: null };

  // Explicit CoA code override wins. Scoped to the active company —
  // each company has its own clean copy of standard codes.
  if (input.contraAccountCode) {
    const companyId = await getActiveCompanyId();
    const a = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId, code: input.contraAccountCode } },
      select: { id: true, isActive: true },
    });
    if (!a) return { error: `CoA code ${input.contraAccountCode} not found` };
    if (!a.isActive) return { error: `CoA ${input.contraAccountCode} is inactive` };
    return { accountId: a.id };
  }

  // Customer / Vendor sub-ledger via ensure-helpers.
  if (input.type === "RECEIPT" && input.customerId) {
    const r = await ensureCustomerCoA(input.customerId);
    if ("error" in r) return { error: r.error };
    return { accountId: r.accountId };
  }
  if (input.type === "PAYMENT" && input.vendorId) {
    const r = await ensureVendorCoA(input.vendorId);
    if ("error" in r) return { error: r.error };
    return { accountId: r.accountId };
  }

  // Type-specific defaults so admin can leave it blank.
  const defaultByType: Record<string, string> = {
    RECEIPT: MISC_INCOME_CODE,
    PAYMENT: MISC_EXPENSE_CODE,
    CHARGE: BANK_CHARGES_CODE,
    INTEREST: INTEREST_INCOME_CODE,
  };
  const code = defaultByType[input.type];
  if (!code) return { error: `Unknown txn type: ${input.type}` };
  const companyId = await getActiveCompanyId();
  const a = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code } },
    select: { id: true },
  });
  if (!a) return { error: `Default CoA ${code} missing — run prisma seed` };
  return { accountId: a.id };
}

export async function createBankTransaction(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const raw = readTxnForm(fd);
  const parsed = bankTransactionSchema.safeParse(raw);
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const date = parseFlexibleDate(parsed.data.date);
  if (!date) return { error: "Invalid date" };

  // Belt-and-braces: ensure the bank's CoA sub-ledger exists before posting.
  const bankCoA = await ensureBankCoA(parsed.data.bankAccountId);
  if ("error" in bankCoA) return { error: bankCoA.error };

  // Resolve contra account.
  const contra = await resolveContraAccountId(raw);
  if ("error" in contra) return { error: contra.error };

  // For TRANSFER make sure both banks have CoA rows.
  if (parsed.data.type === "TRANSFER" && parsed.data.contraBankAccountId) {
    const destCoA = await ensureBankCoA(parsed.data.contraBankAccountId);
    if ("error" in destCoA) return { error: destCoA.error };
  }

  try {
    const txn = await prisma.$transaction(async (tx) => {
      const txnNo = await nextDocNumber("BT", tx);
      return tx.bankTransaction.create({
        data: {
          txnNo,
          date,
          bankAccountId: parsed.data.bankAccountId,
          type: parsed.data.type,
          amount: parsed.data.amount,
          refNo: parsed.data.refNo ?? null,
          narration: parsed.data.narration ?? null,
          customerId: parsed.data.customerId || null,
          vendorId: parsed.data.vendorId || null,
          contraBankAccountId: parsed.data.contraBankAccountId || null,
          contraAccountId: contra.accountId,
          createdBy: me.id,
        },
      });
    });

    await logWrite("BankTransaction", txn.id, "CREATE", null, txn);

    const jvRes = await postBankTransactionJournal(txn.id);
    if (!("ok" in jvRes) || !jvRes.ok) {
      console.error(`[createBankTransaction] postBankTransactionJournal failed for ${txn.id}: ${"error" in jvRes ? jvRes.error : "unknown"}`);
    }

    revalidatePath("/banking/transactions");
    revalidatePath("/banking/accounts");
    revalidatePath("/accounting/journal");
    revalidatePath("/accounting/trial-balance");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/accounting/pnl");
    return { ok: true, id: txn.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create transaction" };
  }
}

export async function deleteBankTransaction(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.bankTransaction.findUnique({ where: { id } });
  if (!before) return { error: "Transaction not found" };

  await reverseAutoJournal("AUTO_BANK_TXN", id);
  await prisma.bankTransaction.delete({ where: { id } });
  await logWrite("BankTransaction", id, "DELETE", before, null);

  revalidatePath("/banking/transactions");
  revalidatePath("/banking/accounts");
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  revalidatePath("/accounting/pnl");
  return { ok: true };
}

// ── Statement Import + Reconciliation (Phase 2 · #129) ────────────────────

type StatementImportResult = {
  ok: true;
  importBatchId: string;
  imported: number;
  skipped: number;
  errors: string[];
} | { ok: false; error: string };

/** Resolve possible column aliases from a CSV header row.
 *  Returns the canonical key map (or null when a required one is missing). */
function mapStatementColumns(headers: string[]): {
  dateCol: string;
  descriptionCol: string;
  refCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  amountCol: string | null;
  typeCol: string | null;
  balanceCol: string | null;
} | { error: string } {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = new Map(headers.map((h) => [norm(h), h]));

  function pick(...candidates: string[]): string | null {
    for (const c of candidates) {
      const got = map.get(c);
      if (got) return got;
    }
    return null;
  }

  const dateCol = pick("date", "txndate", "transactiondate", "valuedate", "postingdate");
  if (!dateCol) return { error: "Missing Date column (expected one of: Date / Txn Date / Value Date)" };

  const descriptionCol = pick("description", "narration", "details", "remarks", "particulars");
  if (!descriptionCol) return { error: "Missing Description column (expected one of: Description / Narration / Particulars)" };

  return {
    dateCol,
    descriptionCol,
    refCol: pick("refno", "reference", "referenceno", "utr", "chqno", "chequeno", "transactionid", "txnid"),
    debitCol: pick("debit", "withdrawal", "withdrawalamount", "dr"),
    creditCol: pick("credit", "deposit", "depositamount", "cr"),
    amountCol: pick("amount", "txnamount", "transactionamount"),
    typeCol: pick("type", "drcr", "transactiontype"),
    balanceCol: pick("balance", "runningbalance", "closingbalance", "balanceamount"),
  };
}

/** Import a CSV statement. Idempotency: caller passes `dedupeKey` (typically
 *  the file name + size) so re-uploading the same file is a no-op when
 *  matched by `(bankAccountId, importBatchId)` later. */
export async function importBankStatement(input: {
  bankAccountId: string;
  csvText: string;
  dedupeKey?: string;
}): Promise<StatementImportResult> {
  const me = await requireAdmin();
  if (!input.bankAccountId) return { ok: false, error: "Bank account required" };

  // Ensure the bank exists + ensure its CoA sub-ledger exists.
  const bank = await prisma.bankAccount.findUnique({
    where: { id: input.bankAccountId },
    select: { id: true, name: true },
  });
  if (!bank) return { ok: false, error: "Bank account not found" };
  await ensureBankCoA(bank.id);

  // papaparse is forgiving with quirky bank exports.
  const parsed = parseCsv<Record<string, string>>(input.csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { ok: false, error: `CSV parse failed: ${parsed.errors[0].message}` };
  }
  const headers = parsed.meta.fields ?? [];
  const colMap = mapStatementColumns(headers);
  if ("error" in colMap) return { ok: false, error: colMap.error };

  const importBatchId = input.dedupeKey ?? randomUUID();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowLabel = `row ${i + 2}`; // +2 = header + 1-index

    const rawDate = row[colMap.dateCol] ?? "";
    const date = parseFlexibleDate(rawDate);
    if (!date) { errors.push(`${rowLabel}: bad date "${rawDate}"`); skipped++; continue; }

    const description = (row[colMap.descriptionCol] ?? "").trim();
    if (!description) { errors.push(`${rowLabel}: empty description`); skipped++; continue; }

    // Direction: if Debit/Credit columns present, take whichever is non-zero.
    // Otherwise look at Amount + Type ("CR"/"DR") or sign of Amount.
    let debit = 0;
    let credit = 0;
    if (colMap.debitCol) debit = Number(stripCommas(row[colMap.debitCol] ?? "0")) || 0;
    if (colMap.creditCol) credit = Number(stripCommas(row[colMap.creditCol] ?? "0")) || 0;
    if (debit === 0 && credit === 0 && colMap.amountCol) {
      const amt = Number(stripCommas(row[colMap.amountCol] ?? "0")) || 0;
      const typeHint = colMap.typeCol ? (row[colMap.typeCol] ?? "").toUpperCase() : "";
      if (typeHint.startsWith("CR") || amt > 0) credit = Math.abs(amt);
      else if (typeHint.startsWith("DR") || amt < 0) debit = Math.abs(amt);
    }
    if (debit === 0 && credit === 0) { errors.push(`${rowLabel}: zero amount`); skipped++; continue; }

    const refNo = colMap.refCol ? (row[colMap.refCol] ?? "").trim() || null : null;
    const balance = colMap.balanceCol
      ? Number(stripCommas(row[colMap.balanceCol] ?? "0")) || null
      : null;

    await prisma.bankStatementLine.create({
      data: {
        bankAccountId: bank.id,
        importBatchId,
        statementDate: date,
        description,
        refNo,
        debit,
        credit,
        balance,
        importedBy: me.id,
      },
    });
    imported++;
  }

  await logWrite("BankStatementLine", importBatchId, "CREATE", null, {
    bankAccountId: bank.id,
    imported,
    skipped,
  });

  revalidatePath("/banking/reconciliation");
  revalidatePath("/banking/accounts");
  return { ok: true, importBatchId, imported, skipped, errors };
}

/** Delete a whole import batch (statement lines only — never touches book
 *  transactions). Matched lines get the matched txn flipped back to
 *  reconciled=false so the book side stays consistent. */
export async function deleteImportBatch(importBatchId: string): Promise<Result> {
  await requireAdmin();
  const lines = await prisma.bankStatementLine.findMany({
    where: { importBatchId },
    select: { id: true, matchedTxnId: true },
  });
  if (lines.length === 0) return { error: "Batch not found or already deleted" };

  // Unreconcile any matched txns first.
  const matchedTxnIds = lines.map((l) => l.matchedTxnId).filter((x): x is string => !!x);
  if (matchedTxnIds.length > 0) {
    await prisma.bankTransaction.updateMany({
      where: { id: { in: matchedTxnIds } },
      data: { reconciled: false, reconciledAt: null },
    });
  }
  await prisma.bankStatementLine.deleteMany({ where: { importBatchId } });
  await logWrite("BankStatementLine", importBatchId, "DELETE", { lineCount: lines.length }, null);
  revalidatePath("/banking/reconciliation");
  return { ok: true };
}

/** Auto-match unmatched lines in a window. Persists matches in one shot. */
export async function autoMatchStatement(input: {
  bankAccountId: string;
  fromIso?: string;
  toIso?: string;
}): Promise<{ ok: true; proposed: number; matched: number; errors: string[] } | { ok: false; error: string }> {
  const me = await requireAdmin();
  const from = input.fromIso ? new Date(input.fromIso) : undefined;
  const to = input.toIso ? new Date(input.toIso) : undefined;
  const r = await findAutoMatches({
    bankAccountId: input.bankAccountId,
    from,
    to,
  });
  const apply = await applyMatches(r.proposals, me.id);
  revalidatePath("/banking/reconciliation");
  return { ok: true, proposed: r.proposalCount, matched: apply.matched, errors: apply.errors };
}

/** Manually match one statement line to one BankTransaction. */
export async function matchStatementLine(input: {
  lineId: string;
  txnId: string;
}): Promise<Result> {
  const me = await requireAdmin();
  const r = await applyMatches([{ lineId: input.lineId, txnId: input.txnId, score: 0, reason: "manual" }], me.id);
  if (r.matched === 0) return { error: r.errors[0] ?? "Match failed" };
  revalidatePath("/banking/reconciliation");
  return { ok: true };
}

/** Undo a match — flips the line back to UNMATCHED + clears the txn flag. */
export async function unmatchStatementLine(lineId: string): Promise<Result> {
  await requireAdmin();
  const line = await prisma.bankStatementLine.findUnique({
    where: { id: lineId },
    select: { matchedTxnId: true },
  });
  if (!line) return { error: "Line not found" };
  await prisma.$transaction(async (tx) => {
    await tx.bankStatementLine.update({
      where: { id: lineId },
      data: { matchStatus: "UNMATCHED", matchedTxnId: null, matchedAt: null, matchedBy: null },
    });
    if (line.matchedTxnId) {
      await tx.bankTransaction.update({
        where: { id: line.matchedTxnId },
        data: { reconciled: false, reconciledAt: null },
      });
    }
  });
  revalidatePath("/banking/reconciliation");
  return { ok: true };
}

/** Mark a line as IGNORED — it stays in the table but counts as resolved. */
export async function ignoreStatementLine(lineId: string): Promise<Result> {
  await requireAdmin();
  const line = await prisma.bankStatementLine.findUnique({
    where: { id: lineId },
    select: { matchStatus: true, matchedTxnId: true },
  });
  if (!line) return { error: "Line not found" };
  // If currently matched, free the txn first.
  await prisma.$transaction(async (tx) => {
    if (line.matchStatus === "MATCHED" && line.matchedTxnId) {
      await tx.bankTransaction.update({
        where: { id: line.matchedTxnId },
        data: { reconciled: false, reconciledAt: null },
      });
    }
    await tx.bankStatementLine.update({
      where: { id: lineId },
      data: { matchStatus: "IGNORED", matchedTxnId: null, matchedAt: null, matchedBy: null },
    });
  });
  revalidatePath("/banking/reconciliation");
  return { ok: true };
}

function stripCommas(s: string): string {
  return (s ?? "").toString().replace(/,/g, "").trim();
}

// ── Order-level Receipt Allocation (Phase 3 · #130) ───────────────────────

export async function allocateReceipt(input: {
  bankTransactionId: string;
  orderId: string;
  amount: number;
}): Promise<Result> {
  const me = await requireAdmin();
  const r = await allocateReceiptHelper({ ...input, by: me.id });
  if (!("ok" in r) || !r.ok) return { error: "error" in r ? r.error : "Allocation failed" };
  await logWrite("BankReceiptAllocation", r.id, "CREATE", null, input);
  revalidatePath("/banking/transactions");
  revalidatePath(`/banking/transactions/${input.bankTransactionId}`);
  revalidatePath("/orders");
  return { ok: true, id: r.id };
}

export async function removeAllocation(allocationId: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.bankReceiptAllocation.findUnique({
    where: { id: allocationId },
    select: { bankTransactionId: true, orderId: true, amount: true },
  });
  if (!before) return { error: "Allocation not found" };
  const r = await removeAllocationHelper(allocationId);
  if (!("ok" in r) || !r.ok) return { error: "error" in r ? r.error : "Delete failed" };
  await logWrite("BankReceiptAllocation", allocationId, "DELETE", before, null);
  revalidatePath("/banking/transactions");
  revalidatePath(`/banking/transactions/${before.bankTransactionId}`);
  revalidatePath("/orders");
  return { ok: true };
}

