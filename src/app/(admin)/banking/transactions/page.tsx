import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ArrowRightLeft, Plus } from "lucide-react";
import { BankTxnTable } from "./BankTxnTable";

export const dynamic = "force-dynamic";

export default async function BankTransactionsPage() {
  await requireAdmin();

  const txns = await prisma.bankTransaction.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      bankAccount: { select: { name: true } },
      contraBank: { select: { name: true } },
      customer: { select: { name: true } },
      vendor: { select: { name: true, code: true } },
      contraAccount: { select: { code: true, name: true } },
    },
  });

  const rows = txns.map((t) => ({
    id: t.id,
    txnNo: t.txnNo,
    date: t.date.toISOString(),
    type: t.type,
    bankName: t.bankAccount.name,
    counterLabel:
      t.type === "TRANSFER"
        ? `→ ${t.contraBank?.name ?? "—"}`
        : t.customer
        ? `Customer · ${t.customer.name}`
        : t.vendor
        ? `Vendor · ${t.vendor.code ? t.vendor.code + " · " : ""}${t.vendor.name}`
        : t.contraAccount
        ? `${t.contraAccount.code} · ${t.contraAccount.name}`
        : "—",
    amount: t.amount,
    refNo: t.refNo,
    narration: t.narration,
  }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-7 w-7 text-brand-yellow" /> Bank Transactions
          </h1>
          <p className="text-sm text-ink-faint">
            Receipts, Payments, Charges, Interest, and inter-account Transfers.
            Each row auto-posts a balanced JV at <span className="font-mono">AUTO_BANK_TXN</span>.
          </p>
        </div>
        <Link
          href="/banking/transactions/new"
          className="btn-primary flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Record Transaction
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card px-4 py-8 text-center text-ink-faint">
          No transactions yet. <Link href="/banking/transactions/new" className="text-brand-yellow underline">Record one</Link>.
        </div>
      ) : (
        <BankTxnTable rows={rows} />
      )}
    </div>
  );
}
