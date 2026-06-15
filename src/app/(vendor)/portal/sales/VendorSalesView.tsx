"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { Search, Download, ShoppingCart } from "lucide-react";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Row = {
  id: string;
  vchDate: Date;
  marketplace: string;
  skuCode: string;
  itemName: string;
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
};

type Filters = { q: string; model: string; type: string; from: string; to: string };
type ModelOption = { code: string; label: string };

export function VendorSalesView({ rows, models, initial }: { rows: Row[]; models: ModelOption[]; initial: Filters }) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "model", "type", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(rows.map((r) => ({
      "Vch Date": toDisplayDate(r.vchDate),
      Marketplace: r.marketplace,
      SKU: r.skuCode,
      Item: r.itemName,
      Model: r.model ?? "",
      Type: r.transactionType,
      Sold: r.qtySold,
      Return: r.qtyReturn,
      RTO: r.qtyRTO,
      "Net Sale": r.netSale,
      Rate: r.unitRate,
      Amount: r.amount,
      "GST Rate": r.taxRate,
      GST: r.gst,
      "Amount+GST": r.totalAmount,
    })));
    downloadCsv("my-sales.csv", csv);
  };

  return (
    <>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-6">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="SKU or item name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
        </div>
        <select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} className="input">
          <option value="">All models</option>
          {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="input">
          <option value="">All types</option>
          <option value="SALE">Sale</option>
          <option value="RETURN">Return</option>
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
        <div className="md:col-span-6 flex gap-2">
          <button type="submit" className="btn-primary">Apply</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Download CSV</button>
        </div>
      </form>

      <ResponsiveTable
        rows={rows}
        columns={salesColumns}
        getRowKey={(r) => r.id}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-ink-faint">
            <ShoppingCart className="h-10 w-10 opacity-40" />
            <div className="text-sm">No sales data for the current filters.</div>
          </div>
        }
      />
    </>
  );
}

const salesColumns: RTColumn<Row>[] = [
  { key: "vchDate", header: "Date", cell: (r) => toDisplayDate(r.vchDate), primary: true },
  { key: "marketplace", header: "Marketplace", cell: (r) => r.marketplace, primary: true },
  { key: "skuCode", header: "SKU", cell: (r) => <span className="font-mono text-xs">{r.skuCode}</span> },
  { key: "itemName", header: "Item", cell: (r) => r.itemName },
  { key: "model", header: "Model", cell: (r) => (r.model ? r.model.replace("_", "-") : "—") },
  {
    key: "transactionType", header: "Type",
    cell: (r) => <span className={`badge ${r.transactionType === "SALE" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{r.transactionType}</span>,
  },
  { key: "qtySold", header: "Sold", cell: (r) => r.qtySold, align: "right" },
  { key: "qtyReturn", header: "Return", cell: (r) => r.qtyReturn, align: "right" },
  { key: "qtyRTO", header: "RTO", cell: (r) => r.qtyRTO, align: "right" },
  { key: "netSale", header: "Net", cell: (r) => <span className="font-medium">{r.netSale.toFixed(2)}</span>, align: "right" },
  { key: "unitRate", header: "Rate", cell: (r) => r.unitRate.toFixed(2), align: "right" },
  { key: "amount", header: "Amount", cell: (r) => r.amount.toFixed(2), align: "right" },
  { key: "gst", header: "GST", cell: (r) => r.gst.toFixed(2), align: "right" },
  { key: "totalAmount", header: "Total", cell: (r) => <span className="font-medium">{r.totalAmount.toFixed(2)}</span>, align: "right", primary: true },
];
