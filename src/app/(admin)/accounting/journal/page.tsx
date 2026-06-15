import Link from "next/link";
import { BookOpen } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { JournalView } from "./JournalView";

export const dynamic = "force-dynamic";

const ENTRY_INCLUDE = {
  lines: { include: { account: { select: { code: true, name: true } } } },
} as const;

type RawEntry = {
  id: string;
  voucherNo: string;
  date: Date;
  narration: string | null;
  source: string;
  lines: { id: string; accountId: string; debit: number; credit: number; narration: string | null; account: { code: string | null; name: string } }[];
};

function mapEntry(e: RawEntry) {
  return {
    id: e.id,
    voucherNo: e.voucherNo,
    date: e.date,
    narration: e.narration,
    source: e.source,
    lines: e.lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      accountCode: l.account.code ?? "",
      accountName: l.account.name,
      debit: l.debit,
      credit: l.credit,
      narration: l.narration,
    })),
  };
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const sp = await searchParams;
  const editId = sp?.edit?.trim();

  const [accounts, entries, editRaw] = await Promise.all([
    prisma.chartOfAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.journalEntry.findMany({
      where: { companyId },
      orderBy: { date: "desc" },
      take: 100,
      include: ENTRY_INCLUDE,
    }),
    editId
      ? prisma.journalEntry.findFirst({ where: { id: editId, companyId }, include: ENTRY_INCLUDE })
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Journal</h1>
          <p className="text-sm text-ink-faint">
            Double-entry journal vouchers. Debits must equal credits. Manual entries can be edited or deleted;
            auto-posted entries can only be undone at their source document.
          </p>
        </div>
        <Link href="/accounting/ledgers" className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap">
          <BookOpen className="h-4 w-4" /> Ledger
        </Link>
      </div>
      <JournalView
        accounts={accounts.map((a) => ({ ...a, code: a.code ?? "" }))}
        entries={entries.map(mapEntry)}
        editEntry={editRaw ? mapEntry(editRaw) : null}
      />

      <div className="mt-8 border-t border-border pt-4">
        <Link href="/accounting/ledgers" className="btn-secondary inline-flex items-center gap-1.5">
          <BookOpen className="h-4 w-4" /> Ledger
        </Link>
        <p className="mt-1 text-[11px] text-ink-faint">
          Browse every ledger like the Chart of Accounts, then drill into its transactions → voucher.
        </p>
      </div>
    </div>
  );
}
