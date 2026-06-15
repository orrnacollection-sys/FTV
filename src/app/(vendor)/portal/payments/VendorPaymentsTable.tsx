"use client";
import { useRouter } from "next/navigation";
import { toDisplayDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { CreditCard, ChevronRight } from "lucide-react";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Row = {
  month: string;
  model: string;
  payable: number;
  adj: number;
  paid: number;
  balance: number;
  status: string;
  utr: string | null;
  paidOn: Date | null;
  remarks: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-800",
  PARTIAL: "border-sky-300 bg-sky-50 text-sky-800",
  PAID: "border-green-300 bg-green-50 text-green-800",
};

export function VendorPaymentsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const openBreakup = (r: Row) =>
    router.push(`/portal/payments/breakup?month=${encodeURIComponent(r.month)}&model=${encodeURIComponent(r.model)}`);

  const columns: RTColumn<Row>[] = [
    { key: "month", header: "Month", cell: (r) => <span className="font-mono">{r.month}</span>, primary: true },
    { key: "model", header: "Model", cell: (r) => MODEL_LABELS[r.model as Model] ?? r.model, primary: true },
    { key: "payable", header: "Payable", cell: (r) => r.payable.toFixed(2), align: "right" },
    {
      key: "adj", header: "Adj",
      cell: (r) => (Math.abs(r.adj) > 0.005
        ? <span className={r.adj < 0 ? "text-amber-700" : "text-orange-700"}>{r.adj > 0 ? "+" : ""}{r.adj.toFixed(2)}</span>
        : "—"),
      align: "right",
    },
    { key: "paid", header: "Paid", cell: (r) => r.paid.toFixed(2), align: "right" },
    {
      key: "balance", header: "Balance",
      cell: (r) => <span className={r.balance > 0.01 ? "text-amber-700 font-bold" : "text-green-700 font-bold"}>{r.balance.toFixed(2)}</span>,
      align: "right", primary: true,
    },
    {
      key: "status", header: "Status",
      cell: (r) => <span className={`badge ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>,
    },
    {
      key: "utr", header: "UTR / Paid On",
      cell: (r) => (
        <div className="text-xs">
          {r.utr ? <div className="font-mono">{r.utr}</div> : null}
          {r.paidOn ? <div className="text-ink-faint">{toDisplayDate(r.paidOn)}</div> : null}
          {!r.utr && !r.paidOn && <span className="text-ink-faint">—</span>}
        </div>
      ),
    },
    { key: "remarks", header: "Remarks", cell: (r) => <span className="text-xs text-ink-mid">{r.remarks ?? ""}</span> },
    { key: "drill", header: "", cell: () => <ChevronRight className="h-4 w-4 text-ink-faint" />, align: "right", desktopOnly: true },
  ];

  return (
    <>
      <p className="mb-2 text-[11px] text-ink-faint"><b>Click a row</b> to see the transaction-level breakup for that month &amp; model.</p>
      <ResponsiveTable
        rows={rows}
        columns={columns}
        getRowKey={(r) => `${r.month}|${r.model}`}
        onRowClick={openBreakup}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-ink-faint">
            <CreditCard className="h-10 w-10 opacity-40" />
            <div className="text-sm">No payables yet.</div>
          </div>
        }
      />
    </>
  );
}
