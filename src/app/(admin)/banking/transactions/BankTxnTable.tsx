"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { Search, Trash2 } from "lucide-react";
import { toast } from "@/components/Toast";
import { deleteBankTransaction } from "../actions";

type Row = {
  id: string;
  txnNo: string;
  date: string;
  type: string;
  bankName: string;
  counterLabel: string;
  amount: number;
  refNo: string | null;
  narration: string | null;
};

const TYPE_TONE: Record<string, string> = {
  RECEIPT: "bg-emerald-100 text-emerald-800",
  PAYMENT: "bg-rose-100 text-rose-800",
  CHARGE: "bg-amber-100 text-amber-800",
  INTEREST: "bg-blue-100 text-blue-800",
  TRANSFER: "bg-violet-100 text-violet-800",
};

export function BankTxnTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.txnNo.toLowerCase().includes(n) ||
      r.bankName.toLowerCase().includes(n) ||
      r.counterLabel.toLowerCase().includes(n) ||
      r.type.toLowerCase().includes(n) ||
      (r.refNo ?? "").toLowerCase().includes(n) ||
      (r.narration ?? "").toLowerCase().includes(n),
    onOpen: (r) => router.push(`/banking/transactions/${r.id}`),
  });

  const onDelete = (id: string, txnNo: string) => {
    if (!window.confirm(`Delete ${txnNo}? This reverses its JV.`)) return;
    startTransition(async () => {
      const res = await deleteBankTransaction(id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Deleted ${txnNo}`);
      router.refresh();
    });
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-brand-yellow-pale/60 px-4 py-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            placeholder="Type to find a transaction…"
            className={`input py-1.5 pl-9 text-sm ${LIST_SEARCH_CLASS}`}
          />
        </div>
        <span className="text-xs text-ink-mid">Latest {rows.length} transactions</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Txn No</th>
            <th className="th">Date</th>
            <th className="th text-center">Type</th>
            <th className="th">Bank</th>
            <th className="th">Counter Party</th>
            <th className="th text-right">Amount ₹</th>
            <th className="th">Ref / Narration</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={8} className="td py-8 text-center text-ink-faint">
                No transactions match.
              </td>
            </tr>
          ) : (
            filtered.map((t, i) => (
              <tr
                key={t.id}
                data-list-row={i}
                onMouseEnter={() => setCursor(i)}
                className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
              >
                <td className="td font-mono text-xs">
                  <Link href={`/banking/transactions/${t.id}`} className="text-brand-yellow hover:underline">
                    {t.txnNo}
                  </Link>
                </td>
                <td className="td text-xs">{toDisplayDate(t.date)}</td>
                <td className="td text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_TONE[t.type] ?? "bg-gray-100"}`}>
                    {t.type}
                  </span>
                </td>
                <td className="td">{t.bankName}</td>
                <td className="td text-xs">{t.counterLabel}</td>
                <td className="td text-right font-mono font-bold">{t.amount.toFixed(2)}</td>
                <td className="td text-xs text-ink-mid">
                  {t.refNo ? <span className="font-mono">{t.refNo}</span> : null}
                  {t.refNo && t.narration ? " · " : null}
                  {t.narration}
                </td>
                <td className="td text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(t.id, t.txnNo)}
                    disabled={pending}
                    className="rounded p-1 hover:bg-rose-50"
                    title="Delete (reverses JV)"
                  >
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
