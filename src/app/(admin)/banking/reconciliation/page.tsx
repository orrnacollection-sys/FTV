import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getReconciliationSummary } from "@/lib/reconciliation";
import { monthRange, defaultPeriod } from "@/lib/gst/period";
import { ReconciliationView } from "./ReconciliationView";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string; period?: string }>;
}) {
  await requireAdmin();
  const { bank: bankParam, period: periodParam } = await searchParams;

  const banks = await prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, accountNo: true, bankName: true },
  });

  if (banks.length === 0) {
    return (
      <div>
        <h1 className="font-display text-3xl font-bold mb-4">Bank Reconciliation</h1>
        <div className="card p-6 text-center text-ink-mid">
          No active bank accounts.{" "}
          <Link href="/banking/accounts/new" className="text-brand-yellow underline">Add one</Link> to begin.
        </div>
      </div>
    );
  }

  const bankAccountId = bankParam && banks.find((b) => b.id === bankParam) ? bankParam : banks[0].id;
  const period = periodParam && /^\d{4}-\d{2}$/.test(periodParam) ? periodParam : defaultPeriod();
  const { from, to } = monthRange(period);
  // Inclusive upper bound for queries.
  const toInclusive = new Date(to.getTime() - 1);

  const [summary, lines, txns] = await Promise.all([
    getReconciliationSummary(bankAccountId, from, toInclusive),
    prisma.bankStatementLine.findMany({
      where: {
        bankAccountId,
        statementDate: { gte: from, lte: toInclusive },
      },
      orderBy: { statementDate: "asc" },
      include: {
        matchedTxn: { select: { id: true, txnNo: true, date: true, amount: true, type: true } },
      },
    }),
    prisma.bankTransaction.findMany({
      where: {
        bankAccountId,
        date: { gte: from, lte: toInclusive },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        txnNo: true,
        date: true,
        type: true,
        amount: true,
        narration: true,
        refNo: true,
        reconciled: true,
      },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Bank Reconciliation</h1>
        <p className="text-sm text-ink-faint">
          Import a bank statement, auto-match against recorded transactions, then resolve the rest by hand.
          Matched lines flip <span className="font-mono">BankTransaction.reconciled = true</span>.
        </p>
      </div>

      <ReconciliationView
        banks={banks}
        initialBankId={bankAccountId}
        initialPeriod={period}
        summary={summary}
        lines={lines.map((l) => ({
          id: l.id,
          statementDate: l.statementDate.toISOString(),
          description: l.description,
          refNo: l.refNo,
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
          matchStatus: l.matchStatus,
          matchedTxn: l.matchedTxn
            ? {
                id: l.matchedTxn.id,
                txnNo: l.matchedTxn.txnNo,
                date: l.matchedTxn.date.toISOString(),
                amount: l.matchedTxn.amount,
                type: l.matchedTxn.type,
              }
            : null,
        }))}
        txns={txns.map((t) => ({
          id: t.id,
          txnNo: t.txnNo,
          date: t.date.toISOString(),
          type: t.type,
          amount: t.amount,
          narration: t.narration,
          refNo: t.refNo,
          reconciled: t.reconciled,
        }))}
      />
    </div>
  );
}
