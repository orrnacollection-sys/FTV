"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Search, Download, Warehouse as WarehouseIcon } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Column = { key: string; label: string };
type Row = {
  id: string;
  skuCode: string;
  name: string;
  vendor: string;
  model: string | null;
  perWarehouse: Record<string, number>;
  total: number;
};
type Vendor = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type WarehouseOption = { id: string; code: string; name: string };
type Filters = { q: string; vendorId: string; model: string; warehouseId: string; from: string; to: string };

export function WarehouseStockView({
  rows,
  columns,
  vendors,
  models,
  modelsWithData,
  warehouses,
  initial,
}: {
  rows: Row[];
  columns: Column[];
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
    (["q", "vendorId", "model", "warehouseId", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => {
        const base: Record<string, unknown> = {
          SKU: r.skuCode,
          Item: r.name,
          Vendor: r.vendor,
          Model: r.model ?? "",
        };
        for (const c of columns) base[c.label] = r.perWarehouse[c.key] ?? 0;
        base.Total = r.total;
        return base;
      }),
      ["SKU", "Item", "Vendor", "Model", ...columns.map((c) => c.label), "Total"],
    );
    downloadCsv("warehouse-stock.csv", csv);
  };

  return (
    <>
      <div className="mb-3 card p-3">
        <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
      </div>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-6">
        <div className="sm:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="SKU or item name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
        </div>
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} className="input">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Apply</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /></button>
        </div>
        <div className="sm:col-span-3 flex items-center gap-2">
          <span className="text-xs text-ink-faint">Date range</span>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              {columns.map((c) => <th key={c.key} className="th text-right">{c.label}</th>)}
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5 + columns.length} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <WarehouseIcon className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No items match.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.name}</td>
                  <td className="td">{r.vendor}</td>
                  <td className="td">{modelLabel(r.model)}</td>
                  {columns.map((c) => {
                    const v = r.perWarehouse[c.key] ?? 0;
                    return (
                      <td key={c.key} className="td text-right tabular-nums">
                        <span className={v < 0 ? "text-red-700" : v === 0 ? "text-ink-faint" : ""}>{v.toFixed(2)}</span>
                      </td>
                    );
                  })}
                  <td className="td text-right tabular-nums font-bold">
                    <span className={r.total < 0 ? "text-red-700" : ""}>{r.total.toFixed(2)}</span>
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
