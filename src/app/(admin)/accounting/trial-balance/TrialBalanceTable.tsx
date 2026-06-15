"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRovingCursor } from "@/hooks/useRovingCursor";

type Row = { id: string; code: string; name: string; type: string; signedDelta: number };

const TYPE_TONE: Record<string, string> = {
  ASSET: "bg-blue-100 text-blue-800",
  LIABILITY: "bg-amber-100 text-amber-800",
  EQUITY: "bg-violet-100 text-violet-800",
  INCOME: "bg-emerald-100 text-emerald-800",
  EXPENSE: "bg-red-100 text-red-800",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function TrialBalanceTable({
  rows,
  totalDr,
  totalCr,
  diff,
}: {
  rows: Row[];
  totalDr: number;
  totalCr: number;
  diff: number;
}) {
  const router = useRouter();
  const { cursor, setCursor } = useRovingCursor({
    count: rows.length,
    onActivate: (i) => { const a = rows[i]; if (a) router.push(`/accounting/ledgers/${a.id}`); },
  });

  useEffect(() => {
    if (cursor < 0) return;
    document.querySelector(`[data-list-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="table-wrap">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th w-24">Code</th>
            <th className="th">Account</th>
            <th className="th">Type</th>
            <th className="th text-right">Debit ₹</th>
            <th className="th text-right">Credit ₹</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="td py-10 text-center text-ink-faint">
              No movements yet. Post a Journal Entry to see accounts populate.
            </td></tr>
          ) : rows.map((a, i) => {
            const drBalance = a.signedDelta > 0.005 ? a.signedDelta : 0;
            const crBalance = a.signedDelta < -0.005 ? -a.signedDelta : 0;
            return (
              <tr
                key={a.id}
                data-list-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => router.push(`/accounting/ledgers/${a.id}`)}
                className={`cursor-pointer ${i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}`}
              >
                <td className="td font-mono text-xs text-brand-yellow-dark">{a.code}</td>
                <td className="td">{a.name}</td>
                <td className="td">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_TONE[a.type]}`}>
                    {a.type}
                  </span>
                </td>
                <td className="td text-right font-mono tabular-nums">{drBalance > 0 ? inr(drBalance) : "—"}</td>
                <td className="td text-right font-mono tabular-nums">{crBalance > 0 ? inr(crBalance) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="td" colSpan={3}>Total</td>
            <td className="td text-right font-mono tabular-nums">{inr(totalDr)}</td>
            <td className="td text-right font-mono tabular-nums">{inr(totalCr)}</td>
          </tr>
          {Math.abs(diff) > 0.01 && (
            <tr>
              <td className="td text-amber-700" colSpan={5}>
                ⚠ Imbalance of ₹{inr(diff)} — every journal entry must have Dr = Cr.
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
