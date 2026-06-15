"use client";
import { toDisplayDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Row = {
  id: string;
  imageUrl: string | null;
  skuCode: string;
  name: string;
  hsn: string | null;
  model: string | null;
  category: string | null;
  rate: number | null;
  taxRate: number | null;
  effectiveDate: Date | null;
};

export function VendorItemsTable({ rows }: { rows: Row[] }) {
  const columns: RTColumn<Row>[] = [
    {
      key: "image", header: "Image", desktopOnly: true,
      cell: (r) =>
        r.imageUrl ? (
          <a href={r.imageUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="block rounded border border-border overflow-hidden hover:ring-2 hover:ring-brand-yellow-dark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.imageUrl} alt={r.name} className="h-10 w-10 object-cover" />
          </a>
        ) : (
          <div className="h-10 w-10 rounded border border-dashed border-border bg-surface-gray-100" />
        ),
    },
    { key: "skuCode", header: "SKU", cell: (r) => <span className="font-mono text-xs">{r.skuCode}</span>, primary: true },
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, primary: true },
    { key: "hsn", header: "HSN", cell: (r) => r.hsn ?? "—" },
    { key: "model", header: "Model", cell: (r) => (r.model ? MODEL_LABELS[r.model as Model] ?? r.model : "—") },
    { key: "category", header: "Category", cell: (r) => r.category ?? "—" },
    { key: "rate", header: "Rate", cell: (r) => (r.rate != null ? r.rate.toFixed(2) : "—"), align: "right", primary: true },
    { key: "taxRate", header: "GST %", cell: (r) => (r.taxRate != null ? `${r.taxRate}%` : "—"), align: "right" },
    { key: "effectiveDate", header: "Effective", cell: (r) => toDisplayDate(r.effectiveDate ?? null) },
  ];

  return (
    <ResponsiveTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.id}
      empty={<div className="text-center text-ink-faint">No items yet. Contact Adwitiya to onboard your SKUs.</div>}
    />
  );
}
