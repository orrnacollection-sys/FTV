"use client";
import Link from "next/link";
import { toDisplayDate } from "@/lib/date";
import { Eye, Truck } from "lucide-react";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Row = {
  id: string;
  grnNo: string;
  grnDate: Date;
  type: string;
  vendorInvoiceNo: string | null;
  accepted: number;
  total: number;
};

export function VendorGRNsTable({ rows }: { rows: Row[] }) {
  const columns: RTColumn<Row>[] = [
    { key: "grnNo", header: "GRN #", cell: (r) => <span className="font-mono">{r.grnNo}</span>, primary: true },
    { key: "grnDate", header: "Date", cell: (r) => toDisplayDate(r.grnDate), primary: true },
    {
      key: "type", header: "Type",
      cell: (r) => <span className={`badge ${r.type === "RTV" ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-800"}`}>{r.type}</span>,
      primary: true,
    },
    { key: "vendorInvoiceNo", header: "Invoice #", cell: (r) => r.vendorInvoiceNo ?? "—" },
    { key: "accepted", header: "Accepted Qty", cell: (r) => r.accepted.toFixed(2), align: "right" },
    { key: "total", header: "Total", cell: (r) => r.total.toFixed(2), align: "right" },
    {
      key: "actions", header: "", desktopOnly: true,
      cell: (r) => (
        <div className="flex justify-end">
          <Link href={`/portal/grn/${r.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="View">
            <Eye className="h-4 w-4" />
          </Link>
        </div>
      ),
      align: "right",
    },
  ];

  return (
    <ResponsiveTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.id}
      onRowClick={(r) => { window.location.href = `/portal/grn/${r.id}`; }}
      empty={
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-ink-faint">
          <Truck className="h-10 w-10 opacity-40" />
          <div className="text-sm">No GRNs yet.</div>
        </div>
      }
    />
  );
}
