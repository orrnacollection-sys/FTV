"use client";
import Link from "next/link";
import { toDisplayDate } from "@/lib/date";
import { Eye, FileText } from "lucide-react";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Row = {
  id: string;
  poNumber: string;
  poDate: Date;
  dueDate: Date | null;
  status: string;
  total: number;
  pending: number;
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-amber-300 bg-amber-50 text-amber-800",
  PARTIALLY_RECEIVED: "border-sky-300 bg-sky-50 text-sky-800",
  CLOSED: "border-gray-300 bg-gray-50 text-gray-700",
  CANCELLED: "border-red-300 bg-red-50 text-red-700",
};

export function VendorPOsTable({ rows }: { rows: Row[] }) {
  const columns: RTColumn<Row>[] = [
    { key: "poNumber", header: "PO #", cell: (r) => <span className="font-mono">{r.poNumber}</span>, primary: true },
    { key: "poDate", header: "Date", cell: (r) => toDisplayDate(r.poDate), primary: true },
    { key: "total", header: "Total", cell: (r) => r.total.toFixed(2), align: "right", primary: true },
    { key: "dueDate", header: "Due", cell: (r) => toDisplayDate(r.dueDate) },
    {
      key: "pending", header: "Pending Qty",
      cell: (r) => (r.pending > 0 ? <span className="font-bold text-amber-700">{r.pending}</span> : "—"),
      align: "right",
    },
    {
      key: "status", header: "Status",
      cell: (r) => <span className={`badge ${STATUS_STYLES[r.status] ?? ""}`}>{r.status.replace("_", " ")}</span>,
    },
    {
      key: "actions", header: "", desktopOnly: true,
      cell: (r) => (
        <div className="flex justify-end">
          <Link href={`/portal/purchase-orders/${r.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="View">
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
      onRowClick={(r) => { window.location.href = `/portal/purchase-orders/${r.id}`; }}
      empty={
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-ink-faint">
          <FileText className="h-10 w-10 opacity-40" />
          <div className="text-sm">No purchase orders yet.</div>
        </div>
      }
    />
  );
}
