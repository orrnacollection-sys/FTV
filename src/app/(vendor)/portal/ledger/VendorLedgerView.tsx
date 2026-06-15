"use client";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { BookOpen, Download } from "lucide-react";
import { ResponsiveTable, type RTColumn } from "@/components/ResponsiveTable";

type Bucket = "FTV" | "OR" | "Other";

type Row = {
  date: Date;
  type: string;
  docNo: string;
  label: string;
  debit: number;
  credit: number;
  model: string | null;
  bucket: Bucket;
};

type BalRow = Row & { balance: number; _idx: number };

const TYPE_STYLES: Record<string, string> = {
  Purchase: "border-green-300 bg-green-50 text-green-800",
  "Return to Vendor": "border-red-300 bg-red-50 text-red-700",
  Payment: "border-sky-300 bg-sky-50 text-sky-800",
};

const BUCKETS: Bucket[] = ["FTV", "OR", "Other"];

export function VendorLedgerView({
  vendorCode,
  rows,
}: {
  vendorCode: string;
  rows: Row[];
}) {
  const [active, setActive] = useState<"All" | Bucket>("All");

  // Only offer a model button when at least one row carries it.
  const present = BUCKETS.filter((b) => rows.some((r) => r.bucket === b));
  const tabs: ("All" | Bucket)[] = ["All", ...present];

  const filtered = active === "All" ? rows : rows.filter((r) => r.bucket === active);

  // Running balance + totals are recomputed for whatever model is active, so the
  // Balance column and the cards always reflect the slice you're looking at.
  let bal = 0;
  const tableRows: BalRow[] = filtered.map((r, _idx) => {
    bal += r.credit - r.debit;
    return { ...r, balance: bal, _idx };
  });
  const summary = {
    totalDebit: filtered.reduce((s, r) => s + r.debit, 0),
    totalCredit: filtered.reduce((s, r) => s + r.credit, 0),
    balance: bal,
  };

  const count = (b: Bucket) => rows.filter((r) => r.bucket === b).length;

  const onDownload = () => {
    const csv = toCsv(
      tableRows.map((r) => ({
        Date: toDisplayDate(r.date),
        Model: r.model ?? "Other",
        Type: r.type,
        "Doc No": r.docNo,
        Label: r.label,
        Debit: r.debit.toFixed(2),
        Credit: r.credit.toFixed(2),
        Balance: r.balance.toFixed(2),
      })),
    );
    downloadCsv(`ledger-${vendorCode}${active === "All" ? "" : "-" + active}.csv`, csv);
  };

  const columns: RTColumn<BalRow>[] = [
    { key: "date", header: "Date", cell: (r) => toDisplayDate(r.date), className: "whitespace-nowrap", primary: true },
    {
      key: "model", header: "Model",
      cell: (r) => <span className="font-mono text-[11px] font-bold text-ink-mid">{r.model ?? "Other"}</span>,
    },
    {
      key: "type", header: "Type",
      cell: (r) => <span className={`badge ${TYPE_STYLES[r.type] ?? ""}`}>{r.type}</span>,
      primary: true,
    },
    { key: "docNo", header: "Doc No", cell: (r) => <span className="font-mono text-xs">{r.docNo}</span> },
    { key: "label", header: "Particulars", cell: (r) => r.label },
    { key: "debit",  header: "Debit",  cell: (r) => (r.debit  > 0 ? r.debit.toFixed(2)  : "—"), align: "right" },
    { key: "credit", header: "Credit", cell: (r) => (r.credit > 0 ? r.credit.toFixed(2) : "—"), align: "right" },
    {
      key: "balance", header: "Balance",
      cell: (r) => <span className="font-medium">{r.balance.toFixed(2)}</span>,
      align: "right", primary: true,
    },
  ];

  return (
    <>
      {/* Model switch — FTV vs OR vs Other */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Model:</span>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs font-semibold transition",
              active === t
                ? "border-brand-yellow bg-brand-yellow text-brand-black"
                : "border-border bg-white text-ink-mid hover:bg-surface-gray-50",
            )}
          >
            {t}
            {t !== "All" && <span className="ml-1 opacity-60">({count(t)})</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Debit</div>
          <div className="font-display text-2xl font-bold tabular-nums">{summary.totalDebit.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Credit</div>
          <div className="font-display text-2xl font-bold tabular-nums">{summary.totalCredit.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Balance owed to you{active === "All" ? "" : ` · ${active}`}
          </div>
          <div className={`font-display text-2xl font-bold tabular-nums ${summary.balance > 0.01 ? "text-amber-700" : "text-green-700"}`}>
            {summary.balance.toFixed(2)}
          </div>
        </div>
      </div>

      {tableRows.length > 0 && (
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={onDownload} className="btn-secondary">
            <Download className="h-4 w-4" /> Download CSV
          </button>
        </div>
      )}

      <ResponsiveTable
        rows={tableRows}
        columns={columns}
        getRowKey={(r) => String(r._idx)}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-ink-faint">
            <BookOpen className="h-10 w-10 opacity-40" />
            <div className="text-sm">No transactions{active === "All" ? " yet" : ` for ${active}`}.</div>
          </div>
        }
      />
    </>
  );
}
