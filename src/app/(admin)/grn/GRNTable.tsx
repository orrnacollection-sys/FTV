"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { toast } from "@/components/Toast";
import { bulkDeleteGRNs } from "./actions";
import { Eye, Search, Truck, Trash2 } from "lucide-react";

type Row = {
  id: string;
  grnNo: string;
  grnDate: Date;
  type: string;
  vendorCode: string | null;
  vendorName: string;
  vendorInvoiceNo: string | null;
  total: number;
  acceptedQty: number;
};

export function GRNTable({
  rows,
  initialQuery,
  initialType,
  lockType = false,
}: {
  rows: Row[];
  initialQuery: string;
  initialType: string;
  lockType?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState(initialType);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const onFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (type) url.searchParams.set("type", type); else url.searchParams.delete("type");
    router.push(url.pathname + url.search);
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.grnNo.toLowerCase().includes(n) ||
      r.vendorName.toLowerCase().includes(n) ||
      (r.vendorCode ?? "").toLowerCase().includes(n) ||
      (r.vendorInvoiceNo ?? "").toLowerCase().includes(n) ||
      r.type.toLowerCase().includes(n),
    onOpen: (r) => router.push(`/grn/${r.id}`),
  });

  const onBulkDelete = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} GRN${selected.size === 1 ? "" : "s"}? PO receivedQty will be rolled back.`)) return;
    startTransition(async () => {
      const res = await bulkDeleteGRNs([...selected]);
      if ("error" in res) toast.error(res.error);
      else {
        if (res.errors.length > 0) toast.error(`Deleted ${res.count}, ${res.errors.length} failed — ${res.errors[0]}`);
        else toast.success(`Deleted ${res.count}`);
        setSelected(new Set()); router.refresh();
      }
    });
  };

  return (
    <>
      <form onSubmit={onFilter} className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Type to find a GRN…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            className={`input pl-9 ${LIST_SEARCH_CLASS}`}
          />
        </div>
        {!lockType && (
          <select value={type} onChange={(e) => setType(e.target.value)} className="input max-w-[180px]">
            <option value="">All types</option>
            <option value="PURCHASE">Purchase</option>
            <option value="RTV">Return to Vendor</option>
            <option value="RFV">Reject-In / RFV</option>
          </select>
        )}
        <button type="submit" className="btn-secondary">Filter</button>
        {selected.size > 0 && (
          <button type="button" onClick={onBulkDelete} disabled={pending} className="btn-danger">
            <Trash2 className="h-4 w-4" /> Delete {selected.size}
          </button>
        )}
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-8">
                <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
              </th>
              <th className="th">GRN #</th>
              <th className="th">Date</th>
              <th className="th">Type</th>
              <th className="th">Vendor</th>
              <th className="th">Invoice #</th>
              <th className="th text-right">Accepted Qty</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Truck className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No GRNs yet.</div>
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
                  <td className="td">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="td font-mono">{r.grnNo}</td>
                  <td className="td">{toDisplayDate(r.grnDate)}</td>
                  <td className="td">
                    <span className={`badge ${r.type === "RTV" ? "border-red-300 bg-red-50 text-red-700" : r.type === "RFV" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-green-300 bg-green-50 text-green-800"}`}>
                      {r.type}
                    </span>
                  </td>
                  <td className="td">
                    <div>{r.vendorName}</div>
                    <div className="text-[10px] font-mono text-ink-faint">{r.vendorCode ?? "—"}</div>
                  </td>
                  <td className="td">{r.vendorInvoiceNo ?? "—"}</td>
                  <td className="td text-right tabular-nums">{r.acceptedQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.total.toFixed(2)}</td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/grn/${r.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="View">
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
