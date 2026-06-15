"use client";
import Link from "next/link";
import { toCsv, downloadCsv } from "@/lib/csv";
import { ArrowLeft, Download, BookOpen } from "lucide-react";

export type SummaryRow = {
  vendorId: string;
  vendorCode: string | null;
  vendorName: string;
  models: string[];
  credit: number;
  debit: number;
  balance: number;
  overdue: number;
};

function modelLabel(code: string) {
  return code.replace(/_/g, "-");
}

export function LedgerSummaryView({
  basis,
  rows,
}: {
  basis: "ON_GRN" | "ON_SALE";
  rows: SummaryRow[];
}) {
  const label = basis === "ON_GRN" ? "OR" : "FTV";
  const totals = rows.reduce(
    (t, r) => ({ credit: t.credit + r.credit, debit: t.debit + r.debit, balance: t.balance + r.balance, overdue: t.overdue + r.overdue }),
    { credit: 0, debit: 0, balance: 0, overdue: 0 },
  );

  const onDownload = () => {
    const csv = toCsv(
      rows.map((r) => ({
        Vendor: `${r.vendorCode ?? "—"} · ${r.vendorName}`,
        Models: r.models.map(modelLabel).join(" + "),
        Credit: r.credit.toFixed(2),
        Debit: r.debit.toFixed(2),
        Balance: r.balance.toFixed(2),
        ...(basis === "ON_GRN" ? { Overdue: r.overdue.toFixed(2) } : {}),
      })),
    );
    downloadCsv(`ledger-${label.toLowerCase()}-summary.csv`, csv);
  };

  return (
    <>
      <div className="mb-4 card p-3 flex flex-wrap items-center gap-3">
        <Link href="/ledger" className="inline-flex items-center gap-1 text-xs font-medium text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to per-vendor view
        </Link>
        <div className="ml-auto flex gap-2">
          <Link href="/ledger?view=or-summary" className={`rounded-full px-3 py-1 text-xs font-medium ${basis === "ON_GRN" ? "bg-brand-black text-white" : "bg-surface-muted text-ink-mid hover:bg-brand-yellow-50"}`}>OR</Link>
          <Link href="/ledger?view=ftv-summary" className={`rounded-full px-3 py-1 text-xs font-medium ${basis === "ON_SALE" ? "bg-brand-black text-white" : "bg-surface-muted text-ink-mid hover:bg-brand-yellow-50"}`}>FTV</Link>
          <button type="button" onClick={onDownload} className="btn-secondary"><Download className="h-4 w-4" /> CSV</button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Vendors with activity</div>
          <div className="font-display text-2xl font-bold tabular-nums">{rows.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Credit</div>
          <div className="font-display text-2xl font-bold tabular-nums text-green-700">{totals.credit.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Debit</div>
          <div className="font-display text-2xl font-bold tabular-nums text-red-700">{totals.debit.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label} Net Owed</div>
          <div className={`font-display text-2xl font-bold tabular-nums ${totals.balance > 0.01 ? "text-amber-700" : "text-green-700"}`}>{totals.balance.toFixed(2)}</div>
          {basis === "ON_GRN" && totals.overdue > 0.01 && (
            <div className="text-[11px] text-red-700 font-semibold">{totals.overdue.toFixed(2)} overdue</div>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Vendor</th>
              <th className="th">Models</th>
              <th className="th text-right">Credit</th>
              <th className="th text-right">Debit</th>
              <th className="th text-right">Balance</th>
              {basis === "ON_GRN" && <th className="th text-right">Overdue</th>}
              <th className="th text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={basis === "ON_GRN" ? 7 : 6} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <BookOpen className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No {label} activity yet.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const firstModel = r.models[0] ?? "";
                const href = `/ledger?vendorId=${r.vendorId}${firstModel ? `&model=${firstModel}` : ""}`;
                return (
                  <tr key={r.vendorId} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-medium">{r.vendorCode ? <span className="font-mono text-xs mr-1 text-ink-faint">{r.vendorCode}</span> : null}{r.vendorName}</td>
                    <td className="td text-xs">{r.models.map(modelLabel).join(" + ") || "—"}</td>
                    <td className="td text-right tabular-nums text-green-700">{r.credit.toFixed(2)}</td>
                    <td className="td text-right tabular-nums text-red-700">{r.debit.toFixed(2)}</td>
                    <td className={`td text-right tabular-nums font-bold ${r.balance > 0.01 ? "text-amber-700" : "text-green-700"}`}>{r.balance.toFixed(2)}</td>
                    {basis === "ON_GRN" && (
                      <td className={`td text-right tabular-nums ${r.overdue > 0.01 ? "text-red-700 font-semibold" : "text-ink-faint"}`}>
                        {r.overdue > 0.01 ? r.overdue.toFixed(2) : "—"}
                      </td>
                    )}
                    <td className="td text-right">
                      <Link href={href} className="text-[11px] font-bold text-brand-yellow-dark hover:underline">Open ledger →</Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
