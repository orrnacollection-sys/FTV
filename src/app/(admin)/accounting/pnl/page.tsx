import { requireAdmin } from "@/lib/rbac";
import { getProfitAndLoss } from "@/lib/accounting";
import { getActivePeriod } from "@/lib/period";
import { parseFlexibleDate, toDisplayDate } from "@/lib/date";
import { PnlTable } from "./PnlTable";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const period = await getActivePeriod();
  const from = sp.from ? parseFlexibleDate(sp.from) ?? period.from : period.from;
  const to = sp.to ? parseFlexibleDate(sp.to) ?? period.to : period.to;

  const { income, expense, netProfit, lines } = await getProfitAndLoss({ from, to });

  const incomeLines = lines.filter((l) => l.type === "INCOME").filter((l) => l.amount !== 0);
  const expenseLines = lines.filter((l) => l.type === "EXPENSE").filter((l) => l.amount !== 0);

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-ink-faint">
            {toDisplayDate(from)} → {toDisplayDate(to)} ·
            Income ₹{inr(income)} − Expense ₹{inr(expense)} = Net {netProfit >= 0 ? "Profit" : "Loss"} ₹{inr(Math.abs(netProfit))}
            <br /><b>↑↓</b> within a side, <b>←→</b> to cross, <b>Enter</b> to drill into a ledger → voucher.
          </p>
        </div>
        <form className="flex items-center gap-2">
          <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} className="input max-w-[160px]" />
          <span className="text-xs text-ink-faint">to</span>
          <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="input max-w-[160px]" />
          <button type="submit" className="btn-secondary">Refresh</button>
        </form>
      </div>

      <PnlTable
        incomeLines={incomeLines.map((l) => ({ id: l.id, code: l.code, name: l.name, amount: l.amount }))}
        expenseLines={expenseLines.map((l) => ({ id: l.id, code: l.code, name: l.name, amount: l.amount }))}
        income={income}
        expense={expense}
        netProfit={netProfit}
      />
    </div>
  );
}
