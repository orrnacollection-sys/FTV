"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Search, Download, Archive } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Row = {
  id: string;
  skuCode: string;
  name: string;
  model: string | null;
  purchaseQty: number;
  rtvQty: number;
  rfvQty: number;
  netInward: number;
  sale: number;
  ret: number;
  rto: number;
  adj: number;
  balance: number;
};
type ModelOption = { code: string; label: string };
type Filters = { q: string; model: string };

export function VendorInventoryView({
  rows,
  models,
  modelsWithData,
  initial,
}: {
  rows: Row[];
  models: ModelOption[];
  modelsWithData: string[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace("_", "-")) : "—";

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (f.q) url.searchParams.set("q", f.q);
    else url.searchParams.delete("q");
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        SKU: r.skuCode,
        Item: r.name,
        Model: modelLabel(r.model),
        Inward: r.purchaseQty,
        RTV: r.rtvQty,
        RFV: r.rfvQty,
        "Net Inward": r.netInward,
        Sale: r.sale,
        Return: r.ret,
        RTO: r.rto,
        Adjustment: r.adj,
        Balance: r.balance,
      })),
      ["SKU", "Item", "Model", "Inward", "RTV", "RFV", "Net Inward", "Sale", "Return", "RTO", "Adjustment", "Balance"],
    );
    downloadCsv("inventory.csv", csv);
  };

  return (
    <>
      <form onSubmit={onSearch} className="mb-4 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            placeholder="Search SKU or item name"
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            className="input pl-9"
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" className="btn-primary flex-1"><Search className="h-4 w-4" /> Search</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export</button>
        </div>
        <div className="sm:col-span-4 -mt-1">
          <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th">Model</th>
              <th className="th text-right">Inward</th>
              <th className="th text-right">RTV</th>
              <th className="th text-right">RFV</th>
              <th className="th text-right">Net Inward</th>
              <th className="th text-right">Sale</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Adj</th>
              <th className="th text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Archive className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No items match.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono text-xs text-brand-yellow-dark">{r.skuCode}</td>
                  <td className="td">{r.name}</td>
                  <td className="td">{modelLabel(r.model)}</td>
                  <td className="td text-right tabular-nums">{r.purchaseQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rtvQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rfvQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-medium">{r.netInward.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.sale.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.ret.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rto.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">
                    <span className={r.adj < 0 ? "text-red-700" : r.adj > 0 ? "text-emerald-700" : ""}>
                      {r.adj > 0 ? "+" : ""}{r.adj.toFixed(2)}
                    </span>
                  </td>
                  <td className="td text-right tabular-nums font-bold">
                    <span className={r.balance < 0 ? "text-red-700" : ""}>{r.balance.toFixed(2)}</span>
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
