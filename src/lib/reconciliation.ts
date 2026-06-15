/**
 * Bank statement reconciliation helpers (#129 — Banking Phase 2).
 *
 * Auto-match: for every UNMATCHED statement line, find the best book
 * BankTransaction candidate. Match rules in priority order:
 *
 *   1. Same bank account, same direction, exact amount.
 *   2. Date within ±tolerance days (default 3).
 *   3. If the line carries a refNo, prefer txns whose refNo is a
 *      substring match (either direction).
 *
 * Returns proposals — caller decides whether to persist (so admin can
 * preview matches before applying).
 */
import { prisma } from "@/lib/db";

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86400 * 1000;

export type MatchProposal = {
  lineId: string;
  txnId: string;
  /** Lower = better. Composite of amount diff + day diff − ref bonus. */
  score: number;
  reason: string;
};

export type AutoMatchInput = {
  bankAccountId: string;
  from?: Date;
  to?: Date;
  /** Amount equality tolerance — default ₹1.00 (covers paise-rounding). */
  amountTolerance?: number;
  /** Date proximity tolerance in days — default 3. */
  dayTolerance?: number;
};

export type AutoMatchResult = {
  proposalCount: number;
  proposals: MatchProposal[];
  /** Lines for which no candidate was found. */
  unmatchedLineIds: string[];
};

/** Identify match proposals. Does NOT persist; that's the caller's choice. */
export async function findAutoMatches(input: AutoMatchInput): Promise<AutoMatchResult> {
  const amountTolerance = input.amountTolerance ?? 1.0;
  const dayTolerance = input.dayTolerance ?? 3;

  // Fetch unmatched statement lines + unmatched (or non-reconciled) book
  // transactions in the window. We pad the date window by tolerance on
  // both sides so edge dates can still match.
  const padMs = dayTolerance * DAY_MS;
  const fromPad = input.from ? new Date(input.from.getTime() - padMs) : undefined;
  const toPad = input.to ? new Date(input.to.getTime() + padMs) : undefined;

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      bankAccountId: input.bankAccountId,
      matchStatus: "UNMATCHED",
      ...(input.from ? { statementDate: { gte: input.from } } : {}),
      ...(input.to ? { statementDate: { lte: input.to } } : {}),
    },
    orderBy: { statementDate: "asc" },
  });

  const txns = await prisma.bankTransaction.findMany({
    where: {
      bankAccountId: input.bankAccountId,
      reconciled: false,
      ...(fromPad ? { date: { gte: fromPad } } : {}),
      ...(toPad ? { date: { lte: toPad } } : {}),
    },
    orderBy: { date: "asc" },
  });

  // For O(1) candidate lookup, bucket book txns by direction + integer rupee.
  type Direction = "CREDIT" | "DEBIT";
  const bucket = new Map<string, typeof txns>();
  for (const t of txns) {
    // RECEIPT / INTEREST = money INTO bank → matches statement CREDIT.
    // PAYMENT / CHARGE / TRANSFER (source side) = money OUT → matches DEBIT.
    const dir: Direction = t.type === "RECEIPT" || t.type === "INTEREST" ? "CREDIT" : "DEBIT";
    const rupee = Math.round(t.amount);
    const key = `${dir}|${rupee}`;
    const arr = bucket.get(key) ?? [];
    arr.push(t);
    bucket.set(key, arr);
  }

  const taken = new Set<string>();
  const proposals: MatchProposal[] = [];
  const unmatchedLineIds: string[] = [];

  for (const line of lines) {
    const dir: Direction = line.credit > 0 ? "CREDIT" : "DEBIT";
    const amount = line.credit > 0 ? line.credit : line.debit;
    const rupee = Math.round(amount);

    // Sweep a few buckets around the integer rupee to handle paise drift.
    const candidates: typeof txns = [];
    for (let r = rupee - 1; r <= rupee + 1; r++) {
      const arr = bucket.get(`${dir}|${r}`);
      if (arr) candidates.push(...arr);
    }

    let best: { txn: typeof txns[number]; score: number; reason: string } | null = null;
    for (const t of candidates) {
      if (taken.has(t.id)) continue;
      const amountDiff = Math.abs(round2(t.amount) - round2(amount));
      if (amountDiff > amountTolerance) continue;
      const dayDiff = Math.abs(line.statementDate.getTime() - t.date.getTime()) / DAY_MS;
      if (dayDiff > dayTolerance) continue;

      // Score: amount diff is more important than date diff. Ref-match
      // gives a -2 bonus (lower score wins).
      let score = amountDiff * 10 + dayDiff;
      let reason = `Δ₹${amountDiff.toFixed(2)} · Δ${Math.round(dayDiff)}d`;
      if (line.refNo && t.refNo) {
        const lineRef = line.refNo.toLowerCase();
        const txnRef = t.refNo.toLowerCase();
        if (lineRef === txnRef) {
          score -= 5;
          reason += " · ref exact";
        } else if (lineRef.includes(txnRef) || txnRef.includes(lineRef)) {
          score -= 2;
          reason += " · ref ~";
        }
      }
      if (!best || score < best.score) best = { txn: t, score, reason };
    }

    if (best) {
      proposals.push({ lineId: line.id, txnId: best.txn.id, score: best.score, reason: best.reason });
      taken.add(best.txn.id);
    } else {
      unmatchedLineIds.push(line.id);
    }
  }

  return {
    proposalCount: proposals.length,
    proposals,
    unmatchedLineIds,
  };
}

/** Persist a list of MatchProposals — flips lines to MATCHED + txns to
 *  reconciled. Single transaction so partial failures don't half-write. */
export async function applyMatches(
  proposals: MatchProposal[],
  by: string,
): Promise<{ matched: number; errors: string[] }> {
  if (proposals.length === 0) return { matched: 0, errors: [] };
  const errors: string[] = [];
  let matched = 0;
  for (const p of proposals) {
    try {
      await prisma.$transaction(async (tx) => {
        // Refuse if either side has changed status since the proposal.
        const line = await tx.bankStatementLine.findUnique({
          where: { id: p.lineId },
          select: { matchStatus: true },
        });
        const txn = await tx.bankTransaction.findUnique({
          where: { id: p.txnId },
          select: { reconciled: true },
        });
        if (!line || !txn) throw new Error("row missing");
        if (line.matchStatus !== "UNMATCHED") throw new Error("line no longer unmatched");
        if (txn.reconciled) throw new Error("txn already reconciled");

        await tx.bankStatementLine.update({
          where: { id: p.lineId },
          data: {
            matchStatus: "MATCHED",
            matchedTxnId: p.txnId,
            matchedAt: new Date(),
            matchedBy: by,
          },
        });
        await tx.bankTransaction.update({
          where: { id: p.txnId },
          data: { reconciled: true, reconciledAt: new Date() },
        });
      });
      matched++;
    } catch (e) {
      errors.push(`${p.lineId.slice(-6)}/${p.txnId.slice(-6)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { matched, errors };
}

/** Reconciliation summary for a bank + month — drives the dashboard widget. */
export async function getReconciliationSummary(
  bankAccountId: string,
  from: Date,
  to: Date,
): Promise<{
  /** Latest statement balance present in any line within range. */
  statementBalance: number | null;
  /** Book balance = opening + Σ JournalLine.debit − Σ JournalLine.credit
   *  on the bank's CoA up to `to`. */
  bookBalance: number;
  unmatchedLines: number;
  unmatchedTxns: number;
  matchedPairs: number;
  ignoredLines: number;
}> {
  const bank = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { openingBalance: true, ledger: { select: { id: true } } },
  });
  if (!bank) throw new Error("Bank account not found");

  // Book balance — sum of journal movements on the bank's CoA up to `to`.
  const movements = bank.ledger
    ? await prisma.journalLine.aggregate({
        where: {
          accountId: bank.ledger.id,
          entry: { date: { lte: to } },
        },
        _sum: { debit: true, credit: true },
      })
    : null;
  const bookBalance = round2(
    bank.openingBalance + (movements?._sum.debit ?? 0) - (movements?._sum.credit ?? 0),
  );

  // Statement balance — take the chronologically last line in range
  // that carries a `balance` value.
  const lastWithBal = await prisma.bankStatementLine.findFirst({
    where: {
      bankAccountId,
      statementDate: { gte: from, lte: to },
      balance: { not: null },
    },
    orderBy: { statementDate: "desc" },
    select: { balance: true },
  });

  const [unmatched, matched, ignored] = await Promise.all([
    prisma.bankStatementLine.count({
      where: { bankAccountId, matchStatus: "UNMATCHED", statementDate: { gte: from, lte: to } },
    }),
    prisma.bankStatementLine.count({
      where: { bankAccountId, matchStatus: "MATCHED", statementDate: { gte: from, lte: to } },
    }),
    prisma.bankStatementLine.count({
      where: { bankAccountId, matchStatus: "IGNORED", statementDate: { gte: from, lte: to } },
    }),
  ]);

  const unmatchedTxns = await prisma.bankTransaction.count({
    where: { bankAccountId, reconciled: false, date: { gte: from, lte: to } },
  });

  return {
    statementBalance: lastWithBal?.balance ?? null,
    bookBalance,
    unmatchedLines: unmatched,
    unmatchedTxns,
    matchedPairs: matched,
    ignoredLines: ignored,
  };
}
