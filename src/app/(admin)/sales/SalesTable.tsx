"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { toast } from "@/components/Toast";
import { importSales, bulkDeleteSales, emailFilteredSales } from "./actions";
import { Upload, Download, Mail, Search, ShoppingCart, Trash2 } from "lucide-react";

type Vendor = { id: string; code: string | null; name: string };
type Row = {
  id: string;
  vchDate: Date;
  marketplace: string;
  skuCode: string;
  itemName: string;
  vendorName: string;
  model: string | null;
  transactionType: string;
  qtySold: number;
  qtyReturn: number;
  qtyRTO: number;
  netSale: number;
  unitRate: number;
  amount: number;
  taxRate: number;
  gst: number;
  totalAmount: number;
  remarks: string | null;
};

type Filters = {
  q: string;
  marketplace: string;
  type: string;
  vendorId: string;
  from: string;
  to: string;
};

export function SalesTable({
  rows,
  vendors,
  initial,
}: {
  rows: Row[];
  vendors: Vendor[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "marketplace", "type", "vendorId", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await importSales(csvRows);
      const msg = `Imported ${res.imported}, skipped ${res.skipped}`;
      if (res.errors.length > 0) {
        toast.error(`${msg} — ${res.errors.slice(0, 3).join(" | ")}`);
      } else {
        toast.success(msg);
      }
      router.refresh();
    });
  };

  const onExport = () => {
    const csv = toCsv(rows.map((r) => ({
      "Vch Date": toDisplayDate(r.vchDate),
      "Marketplace": r.marketplace,
      "SKU": r.skuCode,
      "Item": r.itemName,
      "Vendor": r.vendorName,
      "Model": r.model ?? "",
      "Type": r.transactionType,
      "Sold": r.qtySold,
      "Return": r.qtyReturn,
      "RTO": r.qtyRTO,
      "Net Sale": r.netSale,
      "Rate": r.unitRate,
      "Amount": r.amount,
      "GST Rate": r.taxRate,
      "GST": r.gst,
      "Amount+GST": r.totalAmount,
      "Remarks": r.remarks ?? "",
    })));
    downloadCsv("sales.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{ Date: "30-05-2026", Marketplace: "Myntra", SKU: "SKU-001", Type: "SALE", "Qty Sold": "2", "Qty Return": "0", "Qty RTO": "0", Warehouse: "WH-001", Remarks: "" }],
      ["Date", "Marketplace", "SKU", "Type", "Qty Sold", "Qty Return", "Qty RTO", "Warehouse", "Remarks"],
    );
    downloadCsv("sales-template.csv", csv);
  };

  const onEmail = () => {
    const to = window.prompt("Send filtered sales report to (email):");
    if (!to) return;
    startTransition(async () => {
      const res = await emailFilteredSales(f, to);
      if ("error" in res) toast.error(res.error);
      else toast.success("Email queued (see server console in dev)");
    });
  };

  const onBulkDelete = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} sale row${selected.size === 1 ? "" : "s"}?`)) return;
    startTransition(async () => {
      const res = await bulkDeleteSales([...selected]);
      if ("error" in res) toast.error(res.error);
      else { toast.success(`Deleted ${res.count}`); setSelected(new Set()); router.refresh(); }
    });
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: f.q,
    matches: (r, n) =>
      r.skuCode.toLowerCase().includes(n) ||
      r.itemName.toLowerCase().includes(n) ||
      r.vendorName.toLowerCase().includes(n) ||
      r.marketplace.toLowerCase().includes(n) ||
      (r.model ?? "").toLowerCase().includes(n),
    onOpen: (r) => toggle(r.id),
  });

  return (
    <>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-7">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input ref={searchRef} type="search" placeholder="Type to find a sale…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={searchKeyDown} className={`input pl-9 ${LIST_SEARCH_CLASS}`} />
        </div>
        <input type="text" placeholder="Marketplace" value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })} className="input" />
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="input">
          <option value="">All types</option>
          <option value="SALE">Sale</option>
          <option value="RETURN">Return</option>
        </select>
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
        <div className="md:col-span-7 flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary">Apply filters</button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
          </button>
          <button type="button" onClick={downloadTemplate} className="btn-secondary"><Download className="h-4 w-4" /> Template</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
          <button type="button" onClick={onEmail} className="btn-secondary"><Mail className="h-4 w-4" /> Email report</button>
          {selected.size > 0 && (
            <button type="button" onClick={onBulkDelete} disabled={pending} className="btn-danger">
              <Trash2 className="h-4 w-4" /> Delete {selected.size}
            </button>
          )}
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-8">
                <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
              </th>
              <th className="th">Vch Date</th>
              <th className="th">Marketplace</th>
              <th className="th">SKU</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th">Type</th>
              <th className="th text-right">Sold</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Net Sale</th>
              <th className="th text-right">Rate</th>
              <th className="th text-right">Amount</th>
              <th className="th text-right">GST %</th>
              <th className="th text-right">GST</th>
              <th className="th text-right">Amount+GST</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={16} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <ShoppingCart className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No sales rows.</div>
                    <div className="text-xs">Import CSV with columns: Date, Marketplace, SKU, Qty Sold, Qty Return, Qty RTO, Type.</div>
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
                  <td className="td"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="td">{toDisplayDate(r.vchDate)}</td>
                  <td className="td">{r.marketplace}</td>
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.vendorName}</td>
                  <td className="td">{r.model ? r.model.replace("_", "-") : "—"}</td>
                  <td className="td">
                    <span className={`badge ${r.transactionType === "SALE" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>
                      {r.transactionType}
                    </span>
                  </td>
                  <td className="td text-right tabular-nums">{r.qtySold}</td>
                  <td className="td text-right tabular-nums">{r.qtyReturn}</td>
                  <td className="td text-right tabular-nums">{r.qtyRTO}</td>
                  <td className="td text-right tabular-nums font-medium">{r.netSale.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.unitRate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.amount.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.taxRate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.gst.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-medium">{r.totalAmount.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
