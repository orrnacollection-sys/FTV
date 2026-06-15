"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRovingCursor } from "@/hooks/useRovingCursor";
import { ChevronRight, ScrollText } from "lucide-react";

type Row = { id: string; code: string | null; name: string; dr: number; hasChildren: boolean };

const fmt = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function GroupMembersList({ rows }: { rows: Row[] }) {
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
    <div className="space-y-2">
      <p className="text-[11px] text-ink-faint"><b>↑↓</b> move · <b>Enter</b> open · click a ledger to drill in.</p>
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-24">Code</th>
              <th className="th">Ledger</th>
              <th className="th text-right">Balance ₹</th>
              <th className="th text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="td py-8 text-center text-ink-faint">No ledgers in this group.</td></tr>
            ) : (
              rows.map((a, i) => (
                <tr
                  key={a.id}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => router.push(`/accounting/ledgers/${a.id}`)}
                  className={`cursor-pointer ${i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}`}
                >
                  <td className="td font-mono text-xs font-bold">{a.code ?? "—"}</td>
                  <td className="td">
                    {a.name}
                    {a.hasChildren && (
                      <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">group</span>
                    )}
                  </td>
                  <td className="td text-right font-mono tabular-nums">{fmt(a.dr)} {a.dr >= 0 ? "Dr" : "Cr"}</td>
                  <td className="td text-right">
                    {a.hasChildren
                      ? <ChevronRight className="inline h-4 w-4 text-ink-mid" />
                      : <ScrollText className="inline h-4 w-4 text-ink-mid" />}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
