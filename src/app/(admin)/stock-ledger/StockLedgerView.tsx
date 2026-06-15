"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Search, Download, ScrollText } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Movement = {
  key: string;
  skuCode: string;
  itemName: string;
  vendor: string;
  model: string | null;
  date: string;
  type: string;
  ref: string | null;
  warehouse: string | null;
  inQty: number;
  outQty: number;
  affectsBalance: boolean;
  balance: number;
};
type Vendor = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type WarehouseOption = { id: string; code: string; name: string };
type Filters = { q: string; vendorId: string; model: string; from: string; to: string; type: string; warehouseId: string };

const TYPE_STYLES: Record<string, string> = {
  INWARD: "border-green-300 bg-green-50 text-green-800",
  REJECT_IN: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REJECT_OUT: "border-red-300 bg-red-50 text-red-800",
  SALE: "border-sky-300 bg-sky-50 text-sky-800",
  RETURN: "border-amber-300 bg-amber-50 text-amber-800",
  RTO: "border-orange-300 bg-orange-50 text-orange-800",
  ADJUSTMENT: "border-purple-300 bg-purple-50 text-purple-800",
  TRANSFER: "border-slate-300 bg-slate-50 text-slate-600",
};
const TYPE_LABELS: Record<string, string> = {
  INWARD: "Inward", REJECT_IN: "Reject-In", REJECT_OUT: "Reject-Out", SALE: "Sale",
  RETURN: "Return", RTO: "RTO", ADJUSTMENT: "Adjustment", TRANSFER: "Transfer",
};

export function StockLedgerView({
  movements, singleSku, vendors, models, modelsWithData, warehouses, initial,
}: {
  movements: Movement[];
  singleSku: boolean;
  vendors: Vendor[];
  models: ModelOption[];
  modelsWithData: string[];
  warehouses: WarehouseOption[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace("_", "-")) : "—";

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "vendorId", "model", "from", "to", "type", "warehouseId"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      movements.map((m) => ({
        Date: toDisplayDate(new Date(m.date)),
        SKU: m.skuCode,
        Item: m.itemName,
        Vendor: m.vendor,
        Model: m.model ?? "",
        Type: TYPE_LABELS[m.type] ?? m.type,
        Ref: m.ref ?? "",
        Warehouse: m.warehouse ?? "",
        In: m.inQty || "",
        Out: m.outQty || "",
        Balance: m.affectsBalance ? m.balance : "",
      })),
      ["Date", "SKU", "Item", "Vendor", "Model", "Type", "Ref", "Warehouse", "In", "Out", "Balance"],
    );
    downloadCsv("stock-ledger.csv", csv);
  };

  const inTotal = movements.reduce((s, m) => s + m.inQty, 0);
  const outTotal = movements.reduce((s, m) => s + m.outQty, 0);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Movements</div>
          <div className="font-display text-2xl font-bold tabular-nums">{movements.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total In</div>
          <div className="font-display text-2xl font-bold tabular-nums text-green-700">{inTotal.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Out</div>
          <div className="font-display text-2xl font-bold tabular-nums text-red-700">{outTotal.toFixed(2)}</div>
        </div>
      </div>

      <div className="mb-3 card p-3">
        <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
      </div>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-6">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="SKU or item name (pick one SKU for a clean running balance)" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
        </div>
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="input">
          <option value="">All movements</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} className="input">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
        <div className="md:col-span-7 flex gap-2">
          <button type="submit" className="btn-primary">Apply</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export</button>
        </div>
      </form>

      {!singleSku && movements.length > 0 && (
        <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Showing movements across multiple SKUs — the Balance column is each SKU&apos;s running balance at that point. Filter to one SKU for a single clean statement.
        </div>
      )}

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              {!singleSku && <th className="th">SKU</th>}
              <th className="th">Type</th>
              <th className="th">Ref</th>
              <th className="th">Warehouse</th>
              <th className="th text-right">In</th>
              <th className="th text-right">Out</th>
              <th className="th text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 ? (
              <tr>
                <td colSpan={singleSku ? 7 : 8} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <ScrollText className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No movements match.</div>
                  </div>
                </td>
              </tr>
            ) : (
              movements.map((m) => (
                <tr key={m.key} className="hover:bg-brand-yellow-50/40">
                  <td className="td whitespace-nowrap">{toDisplayDate(new Date(m.date))}</td>
                  {!singleSku && (
                    <td className="td">
                      <div className="font-mono text-xs">{m.skuCode}</div>
                      <div className="text-[10px] text-ink-faint">{modelLabel(m.model)}</div>
                    </td>
                  )}
                  <td className="td"><span className={`badge ${TYPE_STYLES[m.type] ?? ""}`}>{TYPE_LABELS[m.type] ?? m.type}</span></td>
                  <td className="td text-xs">{m.ref ?? "—"}</td>
                  <td className="td text-xs">{m.warehouse ?? "—"}</td>
                  <td className="td text-right tabular-nums text-green-700">{m.inQty ? m.inQty.toFixed(2) : ""}</td>
                  <td className="td text-right tabular-nums text-red-700">{m.outQty ? m.outQty.toFixed(2) : ""}</td>
                  <td className="td text-right tabular-nums font-bold">
                    {m.affectsBalance ? m.balance.toFixed(2) : <span className="text-ink-faint" title="Internal transfer — does not change total on-hand">—</span>}
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
