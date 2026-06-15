import { requireAdmin } from "@/lib/rbac";
import { getBalanceSheet, condenseToGroups } from "@/lib/accounting";
import { getActivePeriod } from "@/lib/period";
import { parseFlexibleDate, toDisplayDate } from "@/lib/date";
import { BalanceSheetTables } from "./BalanceSheetTables";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const period = await getActivePeriod();
  const asOf = sp.asOf ? parseFlexibleDate(sp.asOf) ?? period.to : period.to;

  const bs = await getBalanceSheet({ asOf });

  const pick = (a: { id: string; code: string; name: string; parentId: string | null; balance: number }) =>
    ({ id: a.id, code: a.code, name: a.name, parentId: a.parentId, balance: a.balance });

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Balance Sheet</h1>
          <p className="text-sm text-ink-faint">
            As of {toDisplayDate(asOf)} · Assets must equal Liabilities + Equity · <b>↑↓</b> within a side, <b>←→</b> to cross, <b>Enter</b> to drill into a ledger → voucher
          </p>
        </div>
        <form className="flex items-center gap-2">
          <label className="text-xs text-ink-faint">As of:</label>
          <input type="date" name="asOf" defaultValue={asOf.toISOString().slice(0, 10)} className="input max-w-[180px]" />
          <button type="submit" className="btn-secondary">Refresh</button>
        </form>
      </div>

      {Math.abs(bs.balancingDiff) > 0.01 && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          ⚠ <b>Books don&apos;t balance.</b> Assets − (Liabilities + Equity) = ₹{inr(bs.balancingDiff)}.
          Every journal entry must have Dr = Cr. Check recent entries on the Journal page.
        </div>
      )}

      <BalanceSheetTables
        assets={condenseToGroups(bs.assets).map(pick)}
        liabilities={condenseToGroups(bs.liabilities).map(pick)}
        equity={condenseToGroups(bs.equity).map(pick)}
        totalAssets={bs.totalAssets}
        totalLiabilities={bs.totalLiabilities}
        totalEquity={bs.totalEquity}
        netProfitYTD={bs.netProfitYTD}
        balancingDiff={bs.balancingDiff}
      />
    </div>
  );
}
