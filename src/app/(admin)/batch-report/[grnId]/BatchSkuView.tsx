"use client";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Download, Package } from "lucide-react";
import type { BatchSkuRow } from "@/lib/batch-report";

export function BatchSkuView({ batchNo, rows }: { batchNo: string; rows: BatchSkuRow[] }) {
  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        SKU: r.skuCode,
        Item: r.itemName,
        Warehouse: r.warehouse ?? "",
        Model: r.model ?? "",
        Inward: r.inward.toFixed(2),
        Sale: r.sale.toFixed(2),
        RTO: r.rto.toFixed(2),
        Return: r.ret.toFixed(2),
        Net: r.net.toFixed(2),
        "% Return": r.pctReturn.toFixed(1),
        "Bal Qty": r.balQty.toFixed(2),
      })),
    );
    downloadCsv(`batch-${batchNo}-skuwise.csv`, csv);
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Download CSV</button>
      </div>
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th">Warehouse</th>
              <th className="th">Model</th>
              <th className="th text-right">Inward</th>
              <th className="th text-right">Sale</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">Net</th>
              <th className="th text-right">% Ret</th>
              <th className="th text-right">Bal Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Package className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No SKUs in this batch.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.itemName}</td>
                  <td className="td">{r.warehouse ?? "—"}</td>
                  <td className="td">{r.model ? r.model.replace(/_/g, "-") : "—"}</td>
                  <td className="td text-right tabular-nums">{r.inward.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.sale.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rto.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.ret.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.net.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.pctReturn.toFixed(1)}%</td>
                  <td className="td text-right tabular-nums font-bold">{r.balQty.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
