"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { Download, RefreshCw, FileJson, AlertTriangle } from "lucide-react";
import { periodLabel } from "@/lib/gst/period";
import { exportGSTR1Json } from "../actions";

type GstinOption = { gstin: string; state: string; isDefault: boolean };

type SerializedReport = {
  period: string;
  fp: string;
  gstin: string;
  sellerState: string;
  generatedAt: string;
  summary: {
    documentCount: number;
    totalTaxableValue: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalCess: number;
    totalInvoiceValue: number;
    warnings: string[];
  };
  b2b: Array<{
    invoiceNo: string;
    invoiceDate: string;
    customerName: string;
    customerGstin: string;
    posCode: string;
    posState: string;
    reverseCharge: boolean;
    invoiceType: string;
    invoiceValue: number;
    lines: Array<{ rate: number; taxableValue: number; cgst: number; sgst: number; igst: number; cess: number }>;
    orderId: string;
  }>;
  b2cs: Array<{
    posCode: string;
    posState: string;
    rate: number;
    type: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    orderCount: number;
  }>;
  cdnr: Array<{
    noteNo: string;
    noteDate: string;
    noteType: string;
    customerName: string;
    customerGstin: string;
    posCode: string;
    posState: string;
    reverseCharge: boolean;
    noteValue: number;
    lines: Array<{ rate: number; taxableValue: number; cgst: number; sgst: number; igst: number; cess: number }>;
    originalInvoiceNo: string | null;
    originalInvoiceDate: string | null;
    orderId: string;
  }>;
  hsn: Array<{
    hsn: string;
    description: string | null;
    uqc: string;
    rate: number;
    totalQty: number;
    totalValue: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
  }>;
};

type Tab = "summary" | "b2b" | "b2cs" | "cdnr" | "hsn";

const TAB_LABELS: Record<Tab, string> = {
  summary: "Summary",
  b2b: "4A · B2B",
  b2cs: "7 · B2C Small",
  cdnr: "9B · CDN Registered",
  hsn: "12 · HSN Summary",
};

export function GSTR1View({
  gstins,
  initialPeriod,
  initialGstin,
  initialReport,
}: {
  gstins: GstinOption[];
  initialPeriod: string;
  initialGstin: string;
  initialReport: SerializedReport | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("summary");
  const [period, setPeriod] = useState(initialPeriod);
  const [gstin, setGstin] = useState(initialGstin);
  const [busy, startTransition] = useTransition();
  const report = initialReport;

  function regenerate() {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("period", period);
      if (gstin) params.set("gstin", gstin);
      router.push(`/gst/gstr-1?${params.toString()}`);
      router.refresh();
    });
  }

  function downloadJson() {
    startTransition(async () => {
      const r = await exportGSTR1Json(period, gstin);
      if (!("ok" in r) || !r.ok) {
        toast.error("error" in r ? r.error : "Export failed");
        return;
      }
      const blob = new Blob([r.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Saved ${r.filename}`);
    });
  }

  function downloadCsv(section: Tab) {
    if (!report) return;
    let header: string;
    let rows: string[];
    let stem: string;
    if (section === "b2b") {
      header = "Invoice No,Invoice Date,Customer Name,GSTIN/UIN,POS,Rate %,Taxable Value,CGST,SGST,IGST,CESS,Invoice Value,Reverse Charge,Type";
      rows = report.b2b.flatMap((i) =>
        i.lines.map((l) =>
          [
            i.invoiceNo,
            fmtDate(i.invoiceDate),
            csvField(i.customerName),
            i.customerGstin,
            i.posCode,
            l.rate,
            l.taxableValue,
            l.cgst,
            l.sgst,
            l.igst,
            l.cess,
            i.invoiceValue,
            i.reverseCharge ? "Y" : "N",
            i.invoiceType,
          ].join(","),
        ),
      );
      stem = "B2B";
    } else if (section === "b2cs") {
      header = "POS Code,POS State,Rate %,Type,Taxable Value,CGST,SGST,IGST,CESS,Orders";
      rows = report.b2cs.map((r) =>
        [r.posCode, csvField(r.posState), r.rate, r.type, r.taxableValue, r.cgst, r.sgst, r.igst, r.cess, r.orderCount].join(","),
      );
      stem = "B2CS";
    } else if (section === "cdnr") {
      header = "Note No,Note Date,Note Type,Customer Name,GSTIN,POS,Rate %,Taxable Value,CGST,SGST,IGST,CESS,Note Value,Original Invoice";
      rows = report.cdnr.flatMap((n) =>
        n.lines.map((l) =>
          [
            n.noteNo,
            fmtDate(n.noteDate),
            n.noteType,
            csvField(n.customerName),
            n.customerGstin,
            n.posCode,
            l.rate,
            l.taxableValue,
            l.cgst,
            l.sgst,
            l.igst,
            l.cess,
            n.noteValue,
            n.originalInvoiceNo ?? "",
          ].join(","),
        ),
      );
      stem = "CDNR";
    } else if (section === "hsn") {
      header = "HSN,Description,UQC,Rate %,Total Qty,Total Value,Taxable Value,CGST,SGST,IGST,CESS";
      rows = report.hsn.map((h) =>
        [
          h.hsn,
          csvField(h.description ?? ""),
          h.uqc,
          h.rate,
          h.totalQty,
          h.totalValue,
          h.taxableValue,
          h.cgst,
          h.sgst,
          h.igst,
          h.cess,
        ].join(","),
      );
      stem = "HSN";
    } else {
      return;
    }
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GSTR1_${stem}_${report.gstin}_${report.fp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Saved ${stem} CSV`);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Return Period</span>
          <input
            type="month"
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Filing GSTIN</span>
          <select className="input" value={gstin} onChange={(e) => setGstin(e.target.value)}>
            {gstins.map((g) => (
              <option key={g.gstin} value={g.gstin}>
                {g.gstin} · {g.state}{g.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button onClick={regenerate} className="btn-primary flex items-center gap-1.5" disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Regenerating…" : "Regenerate"}
        </button>
        <button onClick={downloadJson} className="btn-ghost flex items-center gap-1.5" disabled={busy || !report}>
          <FileJson className="h-4 w-4" /> Export Portal JSON
        </button>
        {report && (
          <span className="ml-auto text-xs text-ink-mid">
            Generated {new Date(report.generatedAt).toLocaleString("en-IN")} · {periodLabel(report.period)}
          </span>
        )}
      </div>

      {/* Warnings */}
      {report && report.summary.warnings.length > 0 && (
        <div className="card border-amber-300 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> {report.summary.warnings.length} warning(s) before filing
          </div>
          <ul className="px-4 py-2 text-xs text-amber-900 space-y-1">
            {report.summary.warnings.slice(0, 10).map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
            {report.summary.warnings.length > 10 && (
              <li className="italic">… and {report.summary.warnings.length - 10} more.</li>
            )}
          </ul>
        </div>
      )}

      {report ? (
        <>
          {/* Tabs */}
          <div className="border-b border-border flex gap-0 overflow-x-auto">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition ${
                  tab === t
                    ? "border-brand-yellow text-ink"
                    : "border-transparent text-ink-mid hover:text-ink"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "summary" && <SummaryTab report={report} />}
          {tab === "b2b" && <B2BTab report={report} onCsv={() => downloadCsv("b2b")} />}
          {tab === "b2cs" && <B2CSTab report={report} onCsv={() => downloadCsv("b2cs")} />}
          {tab === "cdnr" && <CDNRTab report={report} onCsv={() => downloadCsv("cdnr")} />}
          {tab === "hsn" && <HSNTab report={report} onCsv={() => downloadCsv("hsn")} />}
        </>
      ) : (
        <div className="card p-6 text-center text-ink-mid">
          No report generated yet. Click <strong>Regenerate</strong>.
        </div>
      )}
    </div>
  );
}

function SummaryTab({ report }: { report: SerializedReport }) {
  const s = report.summary;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <Tile label="Documents" value={s.documentCount.toString()} />
      <Tile label="Taxable Value" value={fmtINR(s.totalTaxableValue)} />
      <Tile label="Total Invoice Value" value={fmtINR(s.totalInvoiceValue)} />
      <Tile label="CGST" value={fmtINR(s.totalCgst)} />
      <Tile label="SGST" value={fmtINR(s.totalSgst)} />
      <Tile label="IGST" value={fmtINR(s.totalIgst)} />
      <Tile label="CESS" value={fmtINR(s.totalCess)} />
      <Tile label="Total GST" value={fmtINR(s.totalCgst + s.totalSgst + s.totalIgst + s.totalCess)} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold">{value}</div>
    </div>
  );
}

function B2BTab({ report, onCsv }: { report: SerializedReport; onCsv: () => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-3 text-xs">
        <span>{report.b2b.length} B2B invoices · taxable ₹{fmtINR(report.b2b.reduce((s, i) => s + i.lines.reduce((x, l) => x + l.taxableValue, 0), 0))} · <b>click an invoice</b> to open its order</span>
        <button onClick={onCsv} className="ml-auto btn-ghost flex items-center gap-1 py-0.5"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Invoice No</th>
            <th className="th">Date</th>
            <th className="th">Customer · GSTIN</th>
            <th className="th text-center">POS</th>
            <th className="th text-right">Rate%</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">CGST</th>
            <th className="th text-right">SGST</th>
            <th className="th text-right">IGST</th>
            <th className="th text-right">Invoice ₹</th>
          </tr>
        </thead>
        <tbody>
          {report.b2b.length === 0 ? (
            <tr><td colSpan={10} className="td text-center py-8 text-ink-faint">No B2B invoices in this period.</td></tr>
          ) : (
            report.b2b.map((i, idx) => {
              const l = i.lines[0];
              return (
                <tr key={idx} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono">
                    <Link href={`/orders/${i.orderId}`} className="text-brand-yellow-dark hover:underline" title="Open the source order">{i.invoiceNo}</Link>
                  </td>
                  <td className="td text-xs">{fmtDate(i.invoiceDate)}</td>
                  <td className="td text-xs">{i.customerName} · <span className="font-mono">{i.customerGstin}</span></td>
                  <td className="td text-center font-mono">{i.posCode}</td>
                  <td className="td text-right font-mono">{l.rate}</td>
                  <td className="td text-right font-mono">{fmtINR(l.taxableValue)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.cgst)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.sgst)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.igst)}</td>
                  <td className="td text-right font-mono font-bold">{fmtINR(i.invoiceValue)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function B2CSTab({ report, onCsv }: { report: SerializedReport; onCsv: () => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-3 text-xs">
        <span>{report.b2cs.length} buckets · taxable ₹{fmtINR(report.b2cs.reduce((s, r) => s + r.taxableValue, 0))}</span>
        <button onClick={onCsv} className="ml-auto btn-ghost flex items-center gap-1 py-0.5"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th text-center">POS</th>
            <th className="th">State</th>
            <th className="th text-right">Rate%</th>
            <th className="th text-center">Type</th>
            <th className="th text-right">Orders</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">CGST</th>
            <th className="th text-right">SGST</th>
            <th className="th text-right">IGST</th>
          </tr>
        </thead>
        <tbody>
          {report.b2cs.length === 0 ? (
            <tr><td colSpan={9} className="td text-center py-8 text-ink-faint">No B2C Small buckets in this period.</td></tr>
          ) : (
            report.b2cs.map((r, idx) => (
              <tr key={idx} className="hover:bg-brand-yellow-50/40">
                <td className="td text-center font-mono">{r.posCode}</td>
                <td className="td text-xs">{r.posState}</td>
                <td className="td text-right font-mono">{r.rate}</td>
                <td className="td text-center">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold">{r.type}</span>
                </td>
                <td className="td text-right">{r.orderCount}</td>
                <td className="td text-right font-mono">{fmtINR(r.taxableValue)}</td>
                <td className="td text-right font-mono">{fmtINR(r.cgst)}</td>
                <td className="td text-right font-mono">{fmtINR(r.sgst)}</td>
                <td className="td text-right font-mono">{fmtINR(r.igst)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CDNRTab({ report, onCsv }: { report: SerializedReport; onCsv: () => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-3 text-xs">
        <span>{report.cdnr.length} notes · value ₹{fmtINR(report.cdnr.reduce((s, n) => s + n.noteValue, 0))}</span>
        <button onClick={onCsv} className="ml-auto btn-ghost flex items-center gap-1 py-0.5"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Note No</th>
            <th className="th">Date</th>
            <th className="th text-center">C/D</th>
            <th className="th">Customer · GSTIN</th>
            <th className="th text-center">POS</th>
            <th className="th text-right">Rate%</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">CGST</th>
            <th className="th text-right">SGST</th>
            <th className="th text-right">IGST</th>
            <th className="th text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {report.cdnr.length === 0 ? (
            <tr><td colSpan={11} className="td text-center py-8 text-ink-faint">No credit/debit notes to registered customers in this period.</td></tr>
          ) : (
            report.cdnr.map((n, idx) => {
              const l = n.lines[0];
              return (
                <tr key={idx} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono">
                    <Link href={`/orders/${n.orderId}`} className="text-brand-yellow-dark hover:underline" title="Open the source order">{n.noteNo}</Link>
                  </td>
                  <td className="td text-xs">{fmtDate(n.noteDate)}</td>
                  <td className="td text-center font-bold">{n.noteType}</td>
                  <td className="td text-xs">{n.customerName} · <span className="font-mono">{n.customerGstin}</span></td>
                  <td className="td text-center font-mono">{n.posCode}</td>
                  <td className="td text-right font-mono">{l.rate}</td>
                  <td className="td text-right font-mono">{fmtINR(l.taxableValue)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.cgst)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.sgst)}</td>
                  <td className="td text-right font-mono">{fmtINR(l.igst)}</td>
                  <td className="td text-right font-mono font-bold">{fmtINR(n.noteValue)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function HSNTab({ report, onCsv }: { report: SerializedReport; onCsv: () => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-3 text-xs">
        <span>{report.hsn.length} HSN rows · taxable ₹{fmtINR(report.hsn.reduce((s, h) => s + h.taxableValue, 0))}</span>
        <button onClick={onCsv} className="ml-auto btn-ghost flex items-center gap-1 py-0.5"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">HSN</th>
            <th className="th">Description</th>
            <th className="th text-center">UQC</th>
            <th className="th text-right">Rate%</th>
            <th className="th text-right">Qty</th>
            <th className="th text-right">Total Value</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">CGST</th>
            <th className="th text-right">SGST</th>
            <th className="th text-right">IGST</th>
          </tr>
        </thead>
        <tbody>
          {report.hsn.length === 0 ? (
            <tr><td colSpan={10} className="td text-center py-8 text-ink-faint">No HSN rows — items missing HSN codes?</td></tr>
          ) : (
            report.hsn.map((h, idx) => (
              <tr key={idx} className="hover:bg-brand-yellow-50/40">
                <td className="td font-mono">{h.hsn}</td>
                <td className="td text-xs text-ink-mid">{h.description ?? "—"}</td>
                <td className="td text-center text-xs">{h.uqc}</td>
                <td className="td text-right font-mono">{h.rate}</td>
                <td className="td text-right font-mono">{h.totalQty}</td>
                <td className="td text-right font-mono">{fmtINR(h.totalValue)}</td>
                <td className="td text-right font-mono">{fmtINR(h.taxableValue)}</td>
                <td className="td text-right font-mono">{fmtINR(h.cgst)}</td>
                <td className="td text-right font-mono">{fmtINR(h.sgst)}</td>
                <td className="td text-right font-mono">{fmtINR(h.igst)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function csvField(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
