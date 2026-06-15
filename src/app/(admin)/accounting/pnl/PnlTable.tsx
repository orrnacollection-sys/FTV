"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTColumnCursor } from "@/hooks/useTColumnCursor";

type Line = { id: string; code: string; name: string; amount: number };

type Cell =
  | { kind: "acct"; id: string; code: string; name: string; amount: number; side: 0 | 1; row: number }
  | { kind: "net"; name: string; amount: number; profit: boolean }
  | null;

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Single T-shaped Profit & Loss account: one table split down the middle —
 * Dr · Expenses on the left, Cr · Income on the right. Net Profit (green) sits
 * on the Expenses side, Net Loss (red) on the Income side, so both columns total
 * the same. Every arrow key drives the cursor (↑↓ within a side, ←→ across);
 * Enter / click drills into the ledger → voucher.
 */
export function PnlTable({
  incomeLines,
  expenseLines,
  income,
  expense,
  netProfit,
}: {
  incomeLines: Line[];
  expenseLines: Line[];
  income: number;
  expense: number;
  netProfit: number;
}) {
  const router = useRouter();
  const isProfit = netProfit >= 0;
  const grandTotal = Math.max(income, expense);

  const { pos, setPos, isActive } = useTColumnCursor({
    left: expenseLines,
    right: incomeLines,
    onOpen: (a) => router.push(`/accounting/ledgers/${a.id}`),
  });
  useEffect(() => {
    if (pos.row < 0) return;
    document.querySelector(`[data-cell="${pos.side}-${pos.row}"]`)?.scrollIntoView({ block: "nearest" });
  }, [pos]);

  const left: Cell[] = [
    ...expenseLines.map((l, i) => ({ kind: "acct" as const, id: l.id, code: l.code, name: l.name, amount: l.amount, side: 0 as const, row: i })),
    ...(isProfit ? [{ kind: "net" as const, name: "Net Profit c/d", amount: netProfit, profit: true }] : []),
  ];
  const right: Cell[] = [
    ...incomeLines.map((l, j) => ({ kind: "acct" as const, id: l.id, code: l.code, name: l.name, amount: l.amount, side: 1 as const, row: j })),
    ...(!isProfit ? [{ kind: "net" as const, name: "Net Loss c/d", amount: Math.abs(netProfit), profit: false }] : []),
  ];
  const n = Math.max(left.length, right.length, 1);

  const renderPair = (cell: Cell, divider: boolean) => {
    const bl = divider ? "border-l-2 border-border" : "";
    if (!cell) return (<><td className={`td ${bl}`} /><td className="td" /></>);
    if (cell.kind === "net") {
      const tone = cell.profit ? "text-emerald-900 bg-emerald-50/70" : "text-red-900 bg-red-50/70";
      return (
        <>
          <td className={`td font-bold ${bl} ${tone}`}>{cell.name}</td>
          <td className={`td text-right font-mono font-bold tabular-nums ${tone}`}>{inr(cell.amount)}</td>
        </>
      );
    }
    const hl = isActive(cell.side, cell.row) ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40";
    return (
      <>
        <td
          data-cell={`${cell.side}-${cell.row}`}
          onMouseEnter={() => setPos({ side: cell.side, row: cell.row })}
          onClick={() => router.push(`/accounting/ledgers/${cell.id}`)}
          className={`td cursor-pointer ${bl} ${hl}`}
        >
          <span className="font-mono text-xs text-brand-yellow-dark">{cell.code}</span> · {cell.name}
        </td>
        <td onMouseEnter={() => setPos({ side: cell.side, row: cell.row })} className={`td text-right font-mono tabular-nums ${hl}`}>
          {inr(cell.amount)}
        </td>
      </>
    );
  };

  return (
    <div className="table-wrap">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[33%]" />
          <col className="w-[17%]" />
          <col className="w-[33%]" />
          <col className="w-[17%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="th text-red-800" colSpan={2}>Dr · Expenses</th>
            <th className="th border-l-2 border-border text-emerald-800" colSpan={2}>Cr · Income</th>
          </tr>
          <tr>
            <th className="th">Particulars</th>
            <th className="th text-right">Amount ₹</th>
            <th className="th border-l-2 border-border">Particulars</th>
            <th className="th text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => (
            <tr key={i} className="align-top">
              {renderPair(left[i] ?? null, false)}
              {renderPair(right[i] ?? null, true)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="td">Total</td>
            <td className="td text-right font-mono tabular-nums">{inr(grandTotal)}</td>
            <td className="td border-l-2 border-border">Total</td>
            <td className="td text-right font-mono tabular-nums">{inr(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
