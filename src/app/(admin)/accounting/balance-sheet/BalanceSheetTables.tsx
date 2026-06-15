"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTColumnCursor } from "@/hooks/useTColumnCursor";

type Row = { id: string; code: string; name: string; parentId: string | null; balance: number };

type Cell =
  | { kind: "acct"; id: string; code: string; name: string; balance: number; side: 0 | 1; row: number; tint: string; isRE: boolean }
  | { kind: "hint"; text: string }
  | null;

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Single T-shaped Balance Sheet (traditional Indian layout) — one table split
 * down the middle: Liabilities & Equity on the LEFT, Assets on the RIGHT, with
 * the two halves the same width. The two Totals face each other and must match
 * (Liabilities + Equity = Assets). Every arrow key drives the cursor (↑↓ within a
 * side, ←→ across); Enter / click drills into the ledger → voucher.
 */
export function BalanceSheetTables({
  assets,
  liabilities,
  equity,
  totalAssets,
  totalLiabilities,
  totalEquity,
  netProfitYTD,
  balancingDiff,
}: {
  assets: Row[];
  liabilities: Row[];
  equity: Row[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netProfitYTD: number;
  balancingDiff: number;
}) {
  const router = useRouter();
  const aRows = assets.filter((a) => a.balance !== 0);
  const lRows = liabilities.filter((a) => a.balance !== 0);
  const eRows = equity.filter((a) => a.balance !== 0);

  const leftAccts = [...lRows, ...eRows]; // Liabilities + Equity (Cr)
  const rightAccts = aRows; // Assets (Dr)
  const { pos, setPos, isActive } = useTColumnCursor({
    left: leftAccts,
    right: rightAccts,
    onOpen: (a) => router.push(`/accounting/ledgers/${a.id}`),
  });
  useEffect(() => {
    if (pos.row < 0) return;
    document.querySelector(`[data-cell="${pos.side}-${pos.row}"]`)?.scrollIntoView({ block: "nearest" });
  }, [pos]);

  const balanced = Math.abs(balancingDiff) < 0.01;

  const left: Cell[] = [
    ...lRows.map((a, j) => ({
      kind: "acct" as const, id: a.id, code: a.code, name: a.name, balance: a.balance,
      side: 0 as const, row: j, tint: "bg-amber-50/40", isRE: false,
    })),
    ...eRows.map((a, k) => ({
      kind: "acct" as const, id: a.id, code: a.code, name: a.name, balance: a.balance,
      side: 0 as const, row: lRows.length + k, tint: "bg-violet-50/40", isRE: a.code === "3200",
    })),
  ];
  if (left.length === 0) left.push({ kind: "hint", text: "No liabilities or equity yet — post owner's capital via a Journal Entry." });
  const right: Cell[] = aRows.map((a, i) => ({
    kind: "acct" as const, id: a.id, code: a.code, name: a.name, balance: a.balance,
    side: 1 as const, row: i, tint: "bg-blue-50/30", isRE: false,
  }));
  const n = Math.max(left.length, right.length, 1);

  const renderPair = (cell: Cell, divider: boolean) => {
    const bl = divider ? "border-l-2 border-border" : "";
    if (!cell) return (<><td className={`td ${bl}`} /><td className="td" /></>);
    if (cell.kind === "hint") {
      return (<><td className={`td ${bl} text-ink-faint`} colSpan={2}>{cell.text}</td></>);
    }
    const hl = isActive(cell.side, cell.row) ? "bg-brand-yellow-light" : `${cell.tint} hover:bg-brand-yellow-50/40`;
    return (
      <>
        <td
          data-cell={`${cell.side}-${cell.row}`}
          onMouseEnter={() => setPos({ side: cell.side, row: cell.row })}
          onClick={() => router.push(`/accounting/ledgers/${cell.id}`)}
          className={`td cursor-pointer ${bl} ${hl}`}
        >
          <span className="font-mono text-xs text-brand-yellow-dark">{cell.code}</span> · {cell.name}
          {cell.isRE && (
            <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
              incl. YTD Net Profit ₹{inr(netProfitYTD)}
            </span>
          )}
        </td>
        <td onMouseEnter={() => setPos({ side: cell.side, row: cell.row })} className={`td text-right font-mono tabular-nums ${hl}`}>
          {inr(cell.balance)}
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
            <th className="th text-amber-800" colSpan={2}>Liabilities &amp; Equity</th>
            <th className="th border-l-2 border-border text-blue-800" colSpan={2}>Assets</th>
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
            <td className="td">Total Liabilities + Equity</td>
            <td className="td text-right font-mono tabular-nums text-amber-900">{inr(totalLiabilities + totalEquity)}</td>
            <td className="td border-l-2 border-border">Total Assets</td>
            <td className="td text-right font-mono tabular-nums text-blue-900">{inr(totalAssets)}</td>
          </tr>
          <tr>
            <td colSpan={4} className={`td text-center text-xs font-semibold ${balanced ? "text-emerald-700" : "text-red-700"}`}>
              {balanced ? "✓ Books balance — Liabilities + Equity = Assets" : `⚠ Out of balance by ₹${inr(balancingDiff)}`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
