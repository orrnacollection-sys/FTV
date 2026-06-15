"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { Search, Pencil, Trash2 } from "lucide-react";
import { toast } from "@/components/Toast";
import { deleteBankAccount } from "../actions";

type Row = {
  id: string;
  name: string;
  bankName: string;
  branch: string | null;
  ifsc: string | null;
  accountNo: string;
  type: string;
  ledgerCode: string | null;
  openingBalance: number;
  balance: number;
  txnCount: number;
  isActive: boolean;
};

const TYPE_TONE: Record<string, string> = {
  CURRENT: "bg-blue-100 text-blue-800",
  SAVINGS: "bg-emerald-100 text-emerald-800",
  OD: "bg-amber-100 text-amber-800",
  CASH: "bg-gray-100 text-gray-700",
};

export function BankAccountTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, startTransition] = useTransition();

  const activeCount = rows.filter((r) => r.isActive).length;
  const totalBalance = rows.filter((r) => r.isActive).reduce((s, r) => s + r.balance, 0);

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.name.toLowerCase().includes(n) ||
      r.bankName.toLowerCase().includes(n) ||
      (r.branch ?? "").toLowerCase().includes(n) ||
      r.accountNo.toLowerCase().includes(n) ||
      (r.ifsc ?? "").toLowerCase().includes(n) ||
      (r.ledgerCode ?? "").toLowerCase().includes(n),
    onOpen: (r) => router.push(`/banking/accounts/${r.id}`),
  });

  const onDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete bank account "${name}"? Only allowed when it has no transactions.`)) return;
    startTransition(async () => {
      const res = await deleteBankAccount(id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Deleted ${name}`);
      router.refresh();
    });
  };

  return (
    <div className="card mb-6">
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-brand-yellow-pale/60 px-4 py-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            placeholder="Type to find an account…"
            className={`input py-1.5 pl-9 text-sm ${LIST_SEARCH_CLASS}`}
          />
        </div>
        <span className="text-xs text-ink-mid">
          {rows.length} accounts · {activeCount} active
        </span>
        <span className="ml-auto font-mono text-xs font-bold">
          Total balance (active): ₹{totalBalance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Name</th>
            <th className="th">Bank · Branch</th>
            <th className="th">A/c No</th>
            <th className="th text-center">Type</th>
            <th className="th">CoA</th>
            <th className="th text-right">Opening ₹</th>
            <th className="th text-right">Balance ₹</th>
            <th className="th text-center">Txns</th>
            <th className="th text-center">Active</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={10} className="td py-8 text-center text-ink-faint">
                No accounts match.
              </td>
            </tr>
          ) : (
            filtered.map((r, i) => (
              <tr
                key={r.id}
                data-list-row={i}
                onMouseEnter={() => setCursor(i)}
                className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
              >
                <td className="td font-semibold">{r.name}</td>
                <td className="td text-xs">
                  {r.bankName}
                  {r.branch ? <span className="text-ink-mid"> · {r.branch}</span> : null}
                  {r.ifsc ? <span className="text-ink-faint"> · {r.ifsc}</span> : null}
                </td>
                <td className="td font-mono text-xs">{r.accountNo}</td>
                <td className="td text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_TONE[r.type] ?? "bg-gray-100"}`}>
                    {r.type}
                  </span>
                </td>
                <td className="td font-mono text-xs">{r.ledgerCode ?? "—"}</td>
                <td className="td text-right font-mono">{r.openingBalance.toFixed(2)}</td>
                <td className={`td text-right font-mono font-bold ${r.balance < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  {r.balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
                <td className="td text-center text-xs">{r.txnCount}</td>
                <td className="td text-center">
                  {r.isActive ? (
                    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">YES</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="td text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/banking/accounts/${r.id}`}
                      className="rounded p-1 hover:bg-brand-yellow-pale"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4 text-ink-mid" />
                    </Link>
                    {r.txnCount === 0 ? (
                      <button
                        type="button"
                        onClick={() => onDelete(r.id, r.name)}
                        disabled={pending}
                        className="rounded p-1 hover:bg-rose-50"
                        title="Delete (no transactions)"
                      >
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
