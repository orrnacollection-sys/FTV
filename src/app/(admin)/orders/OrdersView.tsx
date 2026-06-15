"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { toast } from "@/components/Toast";
import { importMarketplaceOrders, bulkDeleteMarketplaceOrders } from "./actions";
import { RecordSaleDialog } from "./RecordSaleDialog";
import type { SkuPickerItem } from "@/components/SkuPicker";
import { Upload, Download, FileSpreadsheet, Search, ShoppingCart, Trash2, Plus } from "lucide-react";

type Row = {
  id: string;
  date: Date;
  skuCode: string;
  itemName: string;
  marketplace: string;
  channel: string;
  type: string;
  placeOfSupply: string | null;
  qty: number;
  salePrice: number;
  transferPrice: number;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};
type Filters = { q: string; marketplace: string; type: string; channel: string; from: string; to: string };

export type Totals = {
  rowCount: number;
  qtyNet: number;
  salesNet: number;
  transferNet: number;
  marginNet: number;
  marginPct: number | null;
  gstNet: number;
  saleCount: number;
  returnCount: number;
  rtoCount: number;
  b2bCount: number;
  b2cCount: number;
};

export type WarehouseOption = { id: string; code: string; name: string; state: string | null };
export type CustomerOption = { id: string; code: string | null; name: string; gstRegType: string; state: string | null };

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inrFull = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const TYPE_STYLES: Record<string, string> = {
  SALE: "border-green-300 bg-green-50 text-green-800",
  RETURN: "border-amber-300 bg-amber-50 text-amber-800",
  RTO: "border-red-300 bg-red-50 text-red-800",
};

const CHANNEL_STYLES: Record<string, string> = {
  MARKETPLACE: "border-blue-300 bg-blue-50 text-blue-800",
  DIRECT: "border-emerald-300 bg-emerald-50 text-emerald-800",
  WEBSITE: "border-violet-300 bg-violet-50 text-violet-800",
  LEGACY: "border-gray-300 bg-gray-100 text-gray-700",
};

const TEMPLATE_HEADERS = [
  "Date", "SKU", "Marketplace", "Channel Type", "Type", "Place of Supply", "QTY",
  "Sale Price (Unit Rate)", "Transfer Price (Vendor Rate)",
  "Taxable Value", "GST Rate %", "CGST", "SGST", "IGST", "Total", "Remarks",
];

export function OrdersView({
  rows,
  totals,
  items,
  warehouses,
  customers,
  initial,
}: {
  rows: Row[];
  totals: Totals;
  items: SkuPickerItem[];
  warehouses: WarehouseOption[];
  customers: CustomerOption[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [importing, startImport] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "marketplace", "type", "channel", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await importMarketplaceOrders(csvRows);
      const msg = `Imported ${res.imported}, skipped ${res.skipped}`;
      if (res.errors.length > 0) toast.error(`${msg} — ${res.errors.slice(0, 3).join(" | ")}`);
      else toast.success(msg);
      router.refresh();
    });
  };

  const onTemplate = () => {
    const csv = toCsv(
      [{
        Date: "30-05-2026", SKU: "ABCD-001", Marketplace: "Amazon", "Channel Type": "MARKETPLACE", Type: "SALE",
        "Place of Supply": "Uttar Pradesh", QTY: "2",
        "Sale Price (Unit Rate)": "499", "Transfer Price (Vendor Rate)": "350",
        "Taxable Value": "846.61", "GST Rate %": "18",
        CGST: "76.19", SGST: "76.19", IGST: "0", Total: "999",
        Remarks: "Optional — leave Transfer Price blank to auto-resolve from Item Price History",
      }],
      TEMPLATE_HEADERS,
    );
    downloadCsv("orders-template.csv", csv);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        Date: toDisplayDate(r.date), SKU: r.skuCode, Item: r.itemName,
        Marketplace: r.marketplace, "Channel Type": r.channel, Type: r.type,
        "Place of Supply": r.placeOfSupply ?? "", QTY: r.qty,
        "Sale Price (Unit Rate)": r.salePrice, "Transfer Price (Vendor Rate)": r.transferPrice,
        Margin: Math.round((r.salePrice - r.transferPrice) * 100) / 100,
        "Taxable Value": r.taxableValue, "GST Rate %": r.gstRate,
        CGST: r.cgst, SGST: r.sgst, IGST: r.igst, Total: r.total,
      })),
      [
        "Date", "SKU", "Item", "Marketplace", "Channel Type", "Type",
        "Place of Supply", "QTY", "Sale Price (Unit Rate)", "Transfer Price (Vendor Rate)", "Margin",
        "Taxable Value", "GST Rate %", "CGST", "SGST", "IGST", "Total",
      ],
    );
    downloadCsv("orders.csv", csv);
  };

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () =>
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: f.q,
    matches: (r, n) =>
      r.skuCode.toLowerCase().includes(n) ||
      r.itemName.toLowerCase().includes(n) ||
      r.marketplace.toLowerCase().includes(n) ||
      r.channel.toLowerCase().includes(n) ||
      r.type.toLowerCase().includes(n),
    onOpen: (r) => toggle(r.id),
  });

  const onDelete = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} order line${selected.size === 1 ? "" : "s"}?`)) return;
    startDelete(async () => {
      const res = await bulkDeleteMarketplaceOrders([...selected]);
      if ("error" in res) toast.error(res.error);
      else { toast.success(`Deleted ${res.count}`); setSelected(new Set()); router.refresh(); }
    });
  };

  return (
    <>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-8">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input ref={searchRef} type="search" placeholder="Type to find an order…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={searchKeyDown} className={`input pl-9 ${LIST_SEARCH_CLASS}`} />
        </div>
        <input placeholder="Marketplace" value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })} className="input" />
        <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className="input">
          <option value="">All channels</option>
          <option value="MARKETPLACE">Marketplace</option>
          <option value="DIRECT">Direct</option>
          <option value="WEBSITE">Website</option>
          <option value="LEGACY">Legacy (migrated)</option>
        </select>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="input">
          <option value="">All types</option>
          <option value="SALE">Sale</option>
          <option value="RETURN">Return</option>
          <option value="RTO">RTO</option>
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
        <div className="md:col-span-8 flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary">Apply filters</button>
          <button type="button" onClick={() => setRecording(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Record Sale
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onImport(file); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
          </button>
          <button type="button" onClick={onTemplate} className="btn-secondary"><FileSpreadsheet className="h-4 w-4" /> Template</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export</button>
          {selected.size > 0 && (
            <button type="button" onClick={onDelete} disabled={deleting} className="btn-secondary text-red-700">
              <Trash2 className="h-4 w-4" /> Delete {selected.size}
            </button>
          )}
        </div>
      </form>

      <TotalsCard totals={totals} />

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-8"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>
              <th className="th">Date</th>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th">Marketplace</th>
              <th className="th">Channel</th>
              <th className="th">Type</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right" title="Customer-side: what the buyer paid per unit">Sale ₹</th>
              <th className="th text-right">Taxable</th>
              <th className="th text-right">GST %</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <ShoppingCart className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No orders yet. Import the Common Order sheet to get started.</div>
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
                  <td className="td">{toDisplayDate(r.date)}</td>
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.itemName}</td>
                  <td className="td">{r.marketplace}</td>
                  <td className="td"><span className={`badge ${CHANNEL_STYLES[r.channel] ?? ""}`}>{r.channel}</span></td>
                  <td className="td"><span className={`badge ${TYPE_STYLES[r.type] ?? ""}`}>{r.type}</span></td>
                  <td className="td text-right tabular-nums">{r.qty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.salePrice.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.taxableValue.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.gstRate.toFixed(0)}</td>
                  <td className="td text-right tabular-nums font-medium">{r.total.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {recording && (
        <RecordSaleDialog
          items={items}
          warehouses={warehouses}
          customers={customers}
          onClose={() => setRecording(false)}
          onCreated={() => { setRecording(false); router.refresh(); }}
        />
      )}
    </>
  );
}

/**
 * Filter-aware totals strip. Returns and RTOs subtract from net Sales,
 * net Transfer, and net GST, so the margin shown is true-of-reversals.
 * B2B/B2C split is parked until the Customer.gstRegType field lands —
 * shown as "—" with a breadcrumb.
 */
function TotalsCard({ totals }: { totals: Totals }) {
  if (totals.rowCount === 0) return null;
  const marginColor = totals.marginNet >= 0 ? "text-emerald-700" : "text-red-700";
  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
          Totals (filtered)
        </div>
        <div className="text-[11px] text-ink-faint">
          {totals.rowCount} row{totals.rowCount === 1 ? "" : "s"} matching · net of returns &amp; RTOs
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Sales (to Customer)" value={inr.format(totals.salesNet)} subtext={inrFull.format(totals.salesNet) + " ₹"} />
        <Stat label="Transfer (to Vendor)" value={inr.format(totals.transferNet)} subtext={inrFull.format(totals.transferNet) + " ₹"} />
        <Stat
          label="Gross Margin"
          value={inr.format(totals.marginNet)}
          subtext={totals.marginPct !== null ? `${totals.marginPct.toFixed(1)}%` : "—"}
          valueClass={marginColor}
        />
        <Stat label="GST Collected" value={inr.format(totals.gstNet)} />
        <Stat label="Qty (net)" value={inrFull.format(totals.qtyNet)} />
        <Stat
          label="Sales / Returns / RTOs"
          value={`${totals.saleCount} / ${totals.returnCount} / ${totals.rtoCount}`}
        />
        <Stat
          label="B2B / B2C"
          value={`${totals.b2bCount} / ${totals.b2cCount}`}
          subtext={totals.b2bCount + totals.b2cCount > 0
            ? `${Math.round((totals.b2bCount / (totals.b2bCount + totals.b2cCount)) * 100)}% B2B`
            : "no orders"}
        />
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        <strong>Transfer Price</strong> is a snapshot from Item Price History at the order date.
        Currently <em>display-only</em> — vendor payouts still resolve from Item Price History at sale time.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  subtext,
  valueClass,
}: {
  label: string;
  value: string;
  subtext?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface-gray-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${valueClass ?? ""}`}>{value}</div>
      {subtext && <div className="text-[11px] text-ink-faint tabular-nums">{subtext}</div>}
    </div>
  );
}
