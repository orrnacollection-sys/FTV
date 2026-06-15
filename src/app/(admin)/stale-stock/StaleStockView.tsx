"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Hourglass, Download, Plus } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Layer = { grnId: string; grnNo: string; date: string; ageDays: number; qty: number; rate: number };
type Row = {
  itemId: string;
  skuCode: string;
  itemName: string;
  vendorId: string;
  vendorCode: string | null;
  vendorName: string;
  model: string | null;
  thresholdDays: number;
  oldestDate: string;
  oldestAgeDays: number;
  staleQty: number;
  staleValue: number;
  totalOnHand: number;
  layers: Layer[];
};
type Vendor = { id: string; code: string | null; name: string; staleDays: number | null };
type ModelOption = { code: string; label: string };
type Filters = { vendorId: string; model: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function StaleStockView({
  rows, totalStaleValue, vendors, models, modelsWithData, initial,
}: {
  rows: Row[];
  totalStaleValue: number;
  vendors: Vendor[];
  models: ModelOption[];
  modelsWithData: string[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace("_", "-")) : "—";

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["vendorId", "model"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        SKU: r.skuCode, Item: r.itemName,
        Vendor: `${r.vendorCode ?? "—"} · ${r.vendorName}`,
        Model: r.model ?? "",
        "Threshold (days)": r.thresholdDays,
        "Oldest receipt": toDisplayDate(new Date(r.oldestDate)),
        "Oldest age (days)": r.oldestAgeDays,
        "Stale qty": r.staleQty.toFixed(2),
        "Stale value": r.staleValue.toFixed(2),
        "Total on hand": r.totalOnHand.toFixed(2),
      })),
    );
    downloadCsv("stale-stock.csv", csv);
  };

  // Group rows by vendor for the "New RTV for vendor" links
  const byVendor = new Map<string, { name: string; code: string | null; rows: Row[] }>();
  for (const r of rows) {
    const v = byVendor.get(r.vendorId) ?? { name: r.vendorName, code: r.vendorCode, rows: [] };
    v.rows.push(r);
    byVendor.set(r.vendorId, v);
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Stale SKUs</div>
          <div className="font-display text-2xl font-bold tabular-nums">{rows.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Vendors affected</div>
          <div className="font-display text-2xl font-bold tabular-nums">{byVendor.size}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total stale qty</div>
          <div className="font-display text-2xl font-bold tabular-nums">{rows.reduce((s, r) => s + r.staleQty, 0).toFixed(2)}</div>
        </div>
        <div className="card p-4 border-amber-200 bg-amber-50/40">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total stale value</div>
          <div className="font-display text-2xl font-bold tabular-nums text-amber-700">₹{money(totalStaleValue)}</div>
          <div className="text-[11px] text-ink-faint">RTV these to settle the ledger</div>
        </div>
      </div>

      <div className="mb-3 card p-3">
        <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
      </div>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}{v.staleDays != null ? ` (${v.staleDays}d)` : ""}</option>)}
        </select>
        <button type="submit" className="btn-primary">Apply</button>
        <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export</button>
      </form>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Hourglass className="h-12 w-12 mx-auto opacity-40 mb-3 text-ink-faint" />
          <div className="text-sm text-ink-faint">Nothing past its tolerance window. All inventory is within the configured days.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {[...byVendor.entries()].map(([vendorId, v]) => (
            <div key={vendorId} className="card overflow-hidden">
              <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-mono text-xs text-ink-faint mr-2">{v.code ?? "—"}</span>
                  <span className="font-bold">{v.name}</span>
                  <span className="text-ink-faint ml-2">· {v.rows.length} SKU{v.rows.length === 1 ? "" : "s"} · ₹{money(v.rows.reduce((s, r) => s + r.staleValue, 0))} stale value</span>
                </div>
                <Link href={`/rtv/new?vendorId=${vendorId}`} className="btn-yellow text-xs">
                  <Plus className="h-3.5 w-3.5" /> New RTV for {v.name}
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">SKU</th>
                      <th className="th">Item</th>
                      <th className="th">Model</th>
                      <th className="th text-right">Oldest</th>
                      <th className="th text-right">Age (d)</th>
                      <th className="th text-right">Threshold</th>
                      <th className="th text-right">Stale qty</th>
                      <th className="th text-right">Stale value</th>
                      <th className="th text-right">On hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.rows.map((r) => (
                      <tr key={r.itemId} className="hover:bg-brand-yellow-50/40 cursor-pointer" onClick={() => setExpanded(expanded === r.itemId ? null : r.itemId)}>
                        <td className="td font-mono text-xs">{r.skuCode}</td>
                        <td className="td">{r.itemName}</td>
                        <td className="td text-xs">{modelLabel(r.model)}</td>
                        <td className="td text-xs whitespace-nowrap">{toDisplayDate(new Date(r.oldestDate))}</td>
                        <td className={`td text-right tabular-nums ${r.oldestAgeDays > r.thresholdDays * 1.5 ? "text-red-700 font-bold" : "text-amber-700"}`}>{r.oldestAgeDays}</td>
                        <td className="td text-right tabular-nums text-ink-faint">{r.thresholdDays}</td>
                        <td className="td text-right tabular-nums font-bold">{r.staleQty.toFixed(2)}</td>
                        <td className="td text-right tabular-nums font-bold text-amber-700">₹{money(r.staleValue)}</td>
                        <td className="td text-right tabular-nums text-ink-mid">{r.totalOnHand.toFixed(2)}</td>
                      </tr>
                    ))}
                    {v.rows.filter((r) => expanded === r.itemId).map((r) => (
                      <tr key={`${r.itemId}-layers`} className="bg-surface-gray-100">
                        <td colSpan={9} className="td">
                          <div className="text-[10px] uppercase font-bold tracking-wider text-ink-faint mb-1">Remaining FIFO layers for {r.skuCode}</div>
                          <table className="w-full text-xs">
                            <thead><tr><th className="th">GRN</th><th className="th">Received</th><th className="th text-right">Age (d)</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">Value</th></tr></thead>
                            <tbody>
                              {r.layers.map((l) => (
                                <tr key={l.grnId} className={l.ageDays >= r.thresholdDays ? "text-amber-800" : ""}>
                                  <td className="td font-mono text-[11px]">{l.grnNo}</td>
                                  <td className="td">{toDisplayDate(new Date(l.date))}</td>
                                  <td className="td text-right tabular-nums">{l.ageDays}</td>
                                  <td className="td text-right tabular-nums">{l.qty.toFixed(2)}</td>
                                  <td className="td text-right tabular-nums">{l.rate.toFixed(2)}</td>
                                  <td className="td text-right tabular-nums">{(l.qty * l.rate).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
