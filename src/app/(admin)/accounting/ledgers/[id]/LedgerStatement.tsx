"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { useShortcut } from "@/hooks/useShortcut";
import { Search } from "lucide-react";

type Row = {
  lineId: string;
  entryId: string;
  voucherNo: string;
  date: string;
  source: string;
  narration: string | null;
  debit: number;
  credit: number;
  balance: number;
};

const SOURCE_TONE: Record<string, string> = {
  MANUAL: "bg-gray-100 text-gray-700",
  AUTO_SALE: "bg-emerald-100 text-emerald-800",
  AUTO_GRN: "bg-blue-100 text-blue-800",
  AUTO_PAYMENT: "bg-amber-100 text-amber-800",
  AUTO_RECEIPT: "bg-violet-100 text-violet-800",
};

const fmt = (n: number) => Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (n: number) => (n >= 0 ? "Dr" : "Cr");

export function LedgerStatement({
  rows,
  openingDr,
  totalDr,
  totalCr,
}: {
  rows: Row[];
  openingDr: number;
  totalDr: number;
  totalCr: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  // Esc / Backspace retrace the drill path (back to the report or list you came
  // from) instead of climbing URL segments. fireInInputs so Esc works even with
  // the search box focused.
  useShortcut("escape", () => router.back(), { fireInInputs: true, label: "Back", group: "Navigation" });
  useShortcut("backspace", () => router.back(), { hidden: true });

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.voucherNo.toLowerCase().includes(n) ||
      (r.narration ?? "").toLowerCase().includes(n) ||
      r.source.toLowerCase().includes(n),
    onOpen: (r) => router.push(`/accounting/journal?edit=${r.entryId}`),
  });

  const closing = rows.length ? rows[rows.length - 1].balance : openingDr;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input
          ref={searchRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={searchKeyDown}
          placeholder="Type to find a voucher…"
          className={`input pl-9 ${LIST_SEARCH_CLASS}`}
        />
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Voucher</th>
              <th className="th">Particulars</th>
              <th className="th text-right">Debit ₹</th>
              <th className="th text-right">Credit ₹</th>
              <th className="th text-right">Balance ₹</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-surface-gray-50">
              <td className="td" colSpan={5}><span className="text-xs font-bold uppercase tracking-wide text-ink-faint">Opening Balance</span></td>
              <td className="td text-right font-mono font-bold">{fmt(openingDr)} {drcr(openingDr)}</td>
            </tr>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="td py-8 text-center text-ink-faint">
                  {rows.length === 0 ? "No transactions in this ledger yet." : "No vouchers match."}
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr
                  key={r.lineId}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => router.push(`/accounting/journal?edit=${r.entryId}`)}
                  className={`cursor-pointer ${i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}`}
                >
                  <td className="td whitespace-nowrap">{toDisplayDate(r.date)}</td>
                  <td className="td">
                    <span className="font-mono text-xs font-bold">{r.voucherNo}</span>
                    <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${SOURCE_TONE[r.source] ?? "bg-gray-100"}`}>
                      {r.source}
                    </span>
                  </td>
                  <td className="td text-xs text-ink-mid">{r.narration ?? "—"}</td>
                  <td className="td text-right font-mono tabular-nums">{r.debit > 0 ? r.debit.toFixed(2) : ""}</td>
                  <td className="td text-right font-mono tabular-nums">{r.credit > 0 ? r.credit.toFixed(2) : ""}</td>
                  <td className="td text-right font-mono tabular-nums">{fmt(r.balance)} {drcr(r.balance)}</td>
                </tr>
              ))
            )}
            <tr className="border-t-2 border-border bg-surface-gray-50 font-bold">
              <td className="td" colSpan={3}><span className="text-xs uppercase tracking-wide">Closing Balance</span></td>
              <td className="td text-right font-mono tabular-nums">{totalDr.toFixed(2)}</td>
              <td className="td text-right font-mono tabular-nums">{totalCr.toFixed(2)}</td>
              <td className="td text-right font-mono tabular-nums">{fmt(closing)} {drcr(closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint"><b>↑↓</b> move · <b>Enter</b> opens the voucher · click a row to open it.</p>
    </div>
  );
}
