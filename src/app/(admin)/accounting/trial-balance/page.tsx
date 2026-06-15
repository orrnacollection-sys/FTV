import { requireAdmin } from "@/lib/rbac";
import { getTrialBalance, condenseToGroups } from "@/lib/accounting";
import { getActivePeriod } from "@/lib/period";
import { toDisplayDate, parseFlexibleDate } from "@/lib/date";
import { TrialBalanceTable } from "./TrialBalanceTable";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const period = await getActivePeriod();
  const asOf = sp.asOf ? parseFlexibleDate(sp.asOf) ?? period.to : period.to;

  const all = condenseToGroups(await getTrialBalance({ asOf }));
  const rows = all.filter((a) => a.balance !== 0 || a.drMovement !== 0 || a.crMovement !== 0);

  let totalDr = 0;
  let totalCr = 0;
  for (const a of rows) {
    if (a.signedDelta > 0.005) totalDr += a.signedDelta;
    else if (a.signedDelta < -0.005) totalCr += -a.signedDelta;
  }
  const diff = totalDr - totalCr;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Trial Balance</h1>
          <p className="text-sm text-ink-faint">
            As of {toDisplayDate(asOf)} · {rows.length} active accounts · should self-balance (Dr ≡ Cr) · <b>↑↓ + Enter</b> or click to drill into a ledger → voucher
          </p>
        </div>
        <form className="flex items-center gap-2">
          <label className="text-xs text-ink-faint">As of:</label>
          <input type="date" name="asOf" defaultValue={asOf.toISOString().slice(0, 10)} className="input max-w-[180px]" />
          <button type="submit" className="btn-secondary">Refresh</button>
        </form>
      </div>

      <TrialBalanceTable
        rows={rows.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, signedDelta: a.signedDelta }))}
        totalDr={totalDr}
        totalCr={totalCr}
        diff={diff}
      />
    </div>
  );
}
