"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { Eye, Search, FileText } from "lucide-react";

type Row = {
  id: string;
  poNumber: string;
  vendorCode: string | null;
  vendorName: string;
  poDate: Date;
  dueDate: Date | null;
  status: string;
  total: number;
  pendingQty: number;
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-amber-300 bg-amber-50 text-amber-800",
  PARTIALLY_RECEIVED: "border-sky-300 bg-sky-50 text-sky-800",
  CLOSED: "border-gray-300 bg-gray-50 text-gray-700",
  CANCELLED: "border-red-300 bg-red-50 text-red-700",
};

export function POTable({
  rows,
  initialQuery,
  initialStatus,
}: {
  rows: Row[];
  initialQuery: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.poNumber.toLowerCase().includes(n) ||
      r.vendorName.toLowerCase().includes(n) ||
      (r.vendorCode ?? "").toLowerCase().includes(n) ||
      r.status.toLowerCase().includes(n),
    onOpen: (r) => router.push(`/purchase-orders/${r.id}`),
  });

  const onFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (status) url.searchParams.set("status", status); else url.searchParams.delete("status");
    router.push(url.pathname + url.search);
  };

  return (
    <>
      <form onSubmit={onFilter} className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Type to find a PO…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            className={`input pl-9 ${LIST_SEARCH_CLASS}`}
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input max-w-[180px]">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="PARTIALLY_RECEIVED">Partially received</option>
          <option value="CLOSED">Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">PO #</th>
              <th className="th">Date</th>
              <th className="th">Due</th>
              <th className="th">Vendor</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Pending Qty</th>
              <th className="th">Status</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <FileText className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No purchase orders yet.</div>
                  </div>
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
                  <td className="td font-mono">{r.poNumber}</td>
                  <td className="td">{toDisplayDate(r.poDate)}</td>
                  <td className="td">{toDisplayDate(r.dueDate)}</td>
                  <td className="td">
                    <div>{r.vendorName}</div>
                    <div className="text-[10px] font-mono text-ink-faint">{r.vendorCode ?? "—"}</div>
                  </td>
                  <td className="td text-right tabular-nums">{r.total.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">
                    {r.pendingQty > 0 ? <span className="font-bold text-amber-700">{r.pendingQty}</span> : "—"}
                  </td>
                  <td className="td">
                    <span className={`badge ${STATUS_STYLES[r.status] ?? ""}`}>{r.status.replace("_", " ")}</span>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/purchase-orders/${r.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="View">
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
