import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { getTrialBalance, type AccountBalance } from "@/lib/accounting";
import { BackOnEsc } from "@/components/BackOnEsc";
import { LedgerStatement } from "./LedgerStatement";
import { GroupMembersList } from "./GroupMembersList";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

export default async function LedgerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();

  const account = await prisma.chartOfAccount.findFirst({
    where: { id, companyId },
    select: { id: true, code: true, name: true, type: true, openingBalance: true },
  });
  if (!account) notFound();

  const children = await prisma.chartOfAccount.findMany({
    where: { parentId: id, companyId },
    orderBy: { code: "asc" },
    select: { id: true },
  });

  // ── GROUP: this account has child ledgers → drill shows its members (Tally
  //    style). Enter a child to keep drilling; a leaf child opens its vouchers. ──
  if (children.length > 0) {
    const tb = await getTrialBalance();
    const byId = new Map(tb.map((a) => [a.id, a]));
    const kidsByParent = new Map<string, AccountBalance[]>();
    for (const a of tb) {
      if (!a.parentId) continue;
      const arr = kidsByParent.get(a.parentId) ?? [];
      arr.push(a);
      kidsByParent.set(a.parentId, arr);
    }
    const subtree = (aid: string): number => {
      const a = byId.get(aid);
      if (!a) return 0;
      let s = a.signedDelta;
      for (const c of kidsByParent.get(aid) ?? []) s += subtree(c.id);
      return s;
    };
    // Total movement across the subtree — lets us keep a net-zero ledger that
    // still had activity (matches the Trial Balance's keep-if-movement rule).
    const subtreeMv = (aid: string): number => {
      const a = byId.get(aid);
      if (!a) return 0;
      let s = a.drMovement + a.crMovement;
      for (const c of kidsByParent.get(aid) ?? []) s += subtreeMv(c.id);
      return s;
    };
    // Hide zero-balance ledgers (Tally-style); keep any with movement.
    const rows = children
      .map((c) => {
        const a = byId.get(c.id)!;
        return {
          id: a.id,
          code: a.code || null,
          name: a.name,
          dr: r2(subtree(a.id)),
          mv: subtreeMv(a.id),
          hasChildren: (kidsByParent.get(a.id)?.length ?? 0) > 0,
        };
      })
      .filter((r) => Math.abs(r.dr) > 0.005 || r.mv > 0.005);

    return (
      <div>
        <BackOnEsc />
        <div className="mb-6">
          <Link href="/accounting/ledgers" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Back to Ledgers
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold">
            {account.code ? account.code + " · " : ""}{account.name}
          </h1>
          <p className="text-sm text-ink-faint">
            Group — {rows.length} ledger{rows.length === 1 ? "" : "s"}. Press <b>Enter</b> on a ledger to drill in → voucher.
          </p>
        </div>
        <GroupMembersList rows={rows} />
      </div>
    );
  }

  // ── LEAF: show the account's own transactions → voucher ──
  const lines = await prisma.journalLine.findMany({
    where: { accountId: id, entry: { companyId } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }],
    include: { entry: { select: { id: true, voucherNo: true, date: true, source: true, narration: true } } },
  });

  const openingDr =
    account.type === "ASSET" || account.type === "EXPENSE" ? account.openingBalance : -account.openingBalance;

  let running = openingDr;
  const rows = lines.map((l) => {
    running += l.debit - l.credit;
    return {
      lineId: l.id,
      entryId: l.entry.id,
      voucherNo: l.entry.voucherNo,
      date: l.entry.date.toISOString(),
      source: l.entry.source,
      narration: l.narration ?? l.entry.narration,
      debit: l.debit,
      credit: l.credit,
      balance: running,
    };
  });

  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);

  return (
    <div>
      <div className="mb-6">
        <Link href="/accounting/ledgers" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to Ledgers
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">
          {account.code ? account.code + " · " : ""}{account.name}
        </h1>
        <p className="text-sm text-ink-faint">
          Account ledger — {rows.length} transaction{rows.length === 1 ? "" : "s"}. Press <b>Enter</b> on a row to open its voucher.
        </p>
      </div>
      <LedgerStatement rows={rows} openingDr={openingDr} totalDr={totalDr} totalCr={totalCr} />
    </div>
  );
}
