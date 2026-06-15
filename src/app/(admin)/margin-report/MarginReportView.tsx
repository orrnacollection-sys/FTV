"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Search, Download, TrendingUp } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Row = {
  itemId: string;
  skuCode: string;
  itemName: string;
  vendor: string;
  model: string | null;
  saleValue: number;
  returnValue: number;
  rtoValue: number;
  netSale: number;
  commission: number;
  logistics: number;
  marketing: number;
  other: number;
  margin: number;
  transferPrice: number;
  netMargin: number;
  marginPct: number;
  netMarginPct: number;
  netQty: number;
};
type Totals = {
  saleValue: number; netSale: number; commission: number; logistics: number;
  marketing: number; margin: number; cogs: number; netMargin: number;
};
type Vendor = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type Filters = { month: string; vendorId: string; model: string; marketplace: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signClass = (n: number) => (n < 0 ? "text-red-700" : n > 0 ? "text-green-700" : "");

export function MarginReportView({
  rows, totals, vendors, models, modelsWithData, initial,
}: {
  rows: Row[]; totals: Totals; vendors: Vendor[]; models: ModelOption[]; modelsWithData: string[]; initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace("_", "-")) : "—";

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["month", "vendorId", "model", "marketplace"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        SKU: r.skuCode, Item: r.itemName, Vendor: r.vendor, Model: r.model ?? "",
        "Sale Value": r.saleValue.toFixed(2), "Return Value": r.returnValue.toFixed(2), "RTO Value": r.rtoValue.toFixed(2),
        "Net Sale": r.netSale.toFixed(2), Commission: r.commission.toFixed(2), Logistics: r.logistics.toFixed(2),
        Marketing: r.marketing.toFixed(2), Other: r.other.toFixed(2), Margin: r.margin.toFixed(2),
        "Transfer Price (COGS)": r.transferPrice.toFixed(2), "Net Margin": r.netMargin.toFixed(2),
        "Margin %": r.marginPct.toFixed(1), "Net Margin %": r.netMarginPct.toFixed(1),
      })),
      ["SKU", "Item", "Vendor", "Model", "Sale Value", "Return Value", "RTO Value", "Net Sale", "Commission", "Logistics", "Marketing", "Other", "Margin", "Transfer Price (COGS)", "Net Margin", "Margin %", "Net Margin %"],
    );
    downloadCsv("margin-report.csv", csv);
  };

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Net Sale</div>
          <div className="font-display text-2xl font-bold tabular-nums">₹{money(totals.netSale)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Margin</div>
          <div className={`font-display text-2xl font-bold tabular-nums ${signClass(totals.margin)}`}>₹{money(totals.margin)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">COGS</div>
          <div className="font-display text-2xl font-bold tabular-nums">₹{money(totals.cogs)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Net Margin</div>
          <div className={`font-display text-2xl font-bold tabular-nums ${signClass(totals.netMargin)}`}>₹{money(totals.netMargin)}</div>
        </div>
      </div>

      <div className="mb-3 card p-3">
        <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
      </div>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input placeholder="Month (YYYY-MM)" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} className="input" />
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input placeholder="Marketplace" value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })} className="input pl-9" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Apply</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /></button>
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">SKU</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th text-right">Sale</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Net Sale</th>
              <th className="th text-right">Commission</th>
              <th className="th text-right">Logistics</th>
              <th className="th text-right">Marketing</th>
              <th className="th text-right">Margin</th>
              <th className="th text-right">COGS</th>
              <th className="th text-right">Net Margin</th>
              <th className="th text-right">NM %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <TrendingUp className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No marketplace orders in scope. Import orders and set a month filter.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.itemId} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.vendor}</td>
                  <td className="td">{modelLabel(r.model)}</td>
                  <td className="td text-right tabular-nums">{money(r.saleValue)}</td>
                  <td className="td text-right tabular-nums">{money(r.returnValue)}</td>
                  <td className="td text-right tabular-nums">{money(r.rtoValue)}</td>
                  <td className="td text-right tabular-nums font-medium">{money(r.netSale)}</td>
                  <td className="td text-right tabular-nums">{money(r.commission)}</td>
                  <td className="td text-right tabular-nums">{money(r.logistics)}</td>
                  <td className="td text-right tabular-nums">{money(r.marketing)}</td>
                  <td className={`td text-right tabular-nums font-medium ${signClass(r.margin)}`}>{money(r.margin)}</td>
                  <td className="td text-right tabular-nums">{money(r.transferPrice)}</td>
                  <td className={`td text-right tabular-nums font-bold ${signClass(r.netMargin)}`}>{money(r.netMargin)}</td>
                  <td className={`td text-right tabular-nums ${signClass(r.netMargin)}`}>{r.netMarginPct.toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Commission &amp; Logistics = % of net sale per marketplace · Marketing from the Marketing Cost tab · COGS = transfer price × net qty · &ldquo;Other&rdquo; manual entry coming next.
      </p>
    </>
  );
}
