import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { Landmark, Plus } from "lucide-react";
import { BankAccountTable } from "./BankAccountTable";

export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  await requireAdmin();
  const companyId = await getActiveCompanyId();

  const accounts = await prisma.bankAccount.findMany({
    where: { companyId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      ledger: { select: { id: true, code: true } },
      _count: { select: { txns: true } },
    },
  });

  // For each linked CoA, sum movements so we can show running balance.
  const ledgerIds = accounts.map((a) => a.ledger?.id).filter(Boolean) as string[];
  const movements = ledgerIds.length
    ? await prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ledgerIds } },
        _sum: { debit: true, credit: true },
      })
    : [];
  const movByAccountId = new Map(movements.map((m) => [m.accountId, m]));

  const rows = accounts.map((a) => {
    const m = a.ledger ? movByAccountId.get(a.ledger.id) : undefined;
    const dr = m?._sum.debit ?? 0;
    const cr = m?._sum.credit ?? 0;
    // ASSET = debit-balance type — positive when more in than out.
    const balance = a.openingBalance + dr - cr;
    return {
      id: a.id,
      name: a.name,
      bankName: a.bankName,
      branch: a.branch,
      ifsc: a.ifsc,
      accountNo: a.accountNo,
      type: a.type,
      ledgerCode: a.ledger?.code ?? null,
      openingBalance: a.openingBalance,
      balance,
      txnCount: a._count.txns,
      isActive: a.isActive,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <Landmark className="h-7 w-7 text-brand-yellow" /> Bank Accounts
          </h1>
          <p className="text-sm text-ink-faint">
            Own bank + cash accounts. Each one auto-creates a CoA sub-ledger under{" "}
            <span className="font-mono">1120</span> (Bank Accounts).
          </p>
        </div>
        <Link
          href="/banking/accounts/new"
          className="btn-primary flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Bank Account
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card px-4 py-8 text-center text-ink-faint">
          No bank accounts yet. <Link href="/banking/accounts/new" className="text-brand-yellow underline">Add one</Link>.
        </div>
      ) : (
        <BankAccountTable rows={rows} />
      )}
    </div>
  );
}
