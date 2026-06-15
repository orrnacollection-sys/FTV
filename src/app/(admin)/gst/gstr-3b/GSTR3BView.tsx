"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { RefreshCw, Download, AlertTriangle, Printer } from "lucide-react";

type GstinOption = { gstin: string; state: string; isDefault: boolean };

type TaxBlock = { taxableValue: number; igst: number; cgst: number; sgst: number; cess: number };

type S3_2Row = {
  posCode: string;
  posState: string;
  rate: number;
  recipient: string;
  taxableValue: number;
  igst: number;
};

type SerializedReport = {
  period: string;
  fp: string;
  gstin: string;
  sellerState: string;
  generatedAt: string;
  s3_1: {
    a_outward_taxable: TaxBlock;
    b_zero_rated: TaxBlock;
    c_nil_rated_exempt: TaxBlock;
    d_inward_reverse_charge: TaxBlock;
    e_non_gst: TaxBlock;
  };
  s3_2: S3_2Row[];
  s4: {
    a1_import_goods: TaxBlock;
    a2_import_services: TaxBlock;
    a3_reverse_charge: TaxBlock;
    a4_isd: TaxBlock;
    a5_all_other_itc: TaxBlock;
    a_total: TaxBlock;
    b1_rule_38_42_43: TaxBlock;
    b2_others: TaxBlock;
    b_total: TaxBlock;
    c_net_itc: TaxBlock;
  };
  s6_summary: {
    outputTaxTotal: TaxBlock;
    inputItcTotal: TaxBlock;
    netPayable: TaxBlock;
  };
  warnings: string[];
};

export function GSTR3BView({
  gstins,
  initialPeriod,
  initialGstin,
  report,
}: {
  gstins: GstinOption[];
  initialPeriod: string;
  initialGstin: string;
  report: SerializedReport | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);
  const [gstin, setGstin] = useState(initialGstin);

  function regenerate(newPeriod = period, newGstin = gstin) {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("period", newPeriod);
      if (newGstin) params.set("gstin", newGstin);
      router.push(`/gst/gstr-3b?${params.toString()}`);
      router.refresh();
    });
  }

  function downloadCsv() {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`GSTR-3B,${report.gstin},${report.fp}`);
    lines.push("");
    lines.push("Section 3.1 — Outward + RCM Inward,Taxable,IGST,CGST,SGST,CESS");
    lines.push(csvRow("3.1(a) Outward taxable", report.s3_1.a_outward_taxable));
    lines.push(csvRow("3.1(b) Zero-rated", report.s3_1.b_zero_rated));
    lines.push(csvRow("3.1(c) Nil-rated / exempt", report.s3_1.c_nil_rated_exempt));
    lines.push(csvRow("3.1(d) Inward RCM", report.s3_1.d_inward_reverse_charge));
    lines.push(csvRow("3.1(e) Non-GST", report.s3_1.e_non_gst));
    lines.push("");
    lines.push("Section 3.2 — Inter-state to UR/COMP/UIN");
    lines.push("POS Code,POS State,Recipient,Rate %,Taxable,IGST");
    for (const r of report.s3_2) {
      lines.push([r.posCode, csvField(r.posState), r.recipient, r.rate, r.taxableValue, r.igst].join(","));
    }
    lines.push("");
    lines.push("Section 4 — Eligible ITC,Taxable,IGST,CGST,SGST,CESS");
    lines.push(csvRow("4(A1) Import goods", report.s4.a1_import_goods));
    lines.push(csvRow("4(A2) Import services", report.s4.a2_import_services));
    lines.push(csvRow("4(A3) RCM", report.s4.a3_reverse_charge));
    lines.push(csvRow("4(A4) ISD", report.s4.a4_isd));
    lines.push(csvRow("4(A5) All other ITC", report.s4.a5_all_other_itc));
    lines.push(csvRow("4(A) Total ITC available", report.s4.a_total));
    lines.push(csvRow("4(B) Total ITC reversed", report.s4.b_total));
    lines.push(csvRow("4(C) Net ITC available", report.s4.c_net_itc));
    lines.push("");
    lines.push("Section 6 — Tax payable summary,Taxable,IGST,CGST,SGST,CESS");
    lines.push(csvRow("Output tax (3.1 a+b)", report.s6_summary.outputTaxTotal));
    lines.push(csvRow("Input ITC (4.C)", report.s6_summary.inputItcTotal));
    lines.push(csvRow("Net cash payable", report.s6_summary.netPayable));

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GSTR3B_${report.gstin}_${report.fp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Saved CSV");
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3 print:hidden">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Return Period</span>
          <input
            type="month"
            className="input"
            value={period}
            onChange={(e) => { setPeriod(e.target.value); regenerate(e.target.value, gstin); }}
          />
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Filing GSTIN</span>
          <select className="input" value={gstin} onChange={(e) => { setGstin(e.target.value); regenerate(period, e.target.value); }}>
            {gstins.map((g) => (
              <option key={g.gstin} value={g.gstin}>{g.gstin} · {g.state}{g.isDefault ? " (default)" : ""}</option>
            ))}
          </select>
        </label>
        <button onClick={() => regenerate()} className="btn-primary flex items-center gap-1.5" disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Regenerating…" : "Regenerate"}
        </button>
        <button onClick={downloadCsv} className="btn-ghost flex items-center gap-1.5" disabled={busy || !report}>
          <Download className="h-4 w-4" /> CSV
        </button>
        <button onClick={() => window.print()} className="btn-ghost flex items-center gap-1.5" disabled={!report}>
          <Printer className="h-4 w-4" /> Print
        </button>
      </div>

      {report && report.warnings.length > 0 && (
        <div className="card border-amber-300 bg-amber-50 print:hidden">
          <div className="border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> {report.warnings.length} warning(s)
          </div>
          <ul className="px-4 py-2 text-xs text-amber-900 space-y-1">
            {report.warnings.slice(0, 10).map((w, i) => (<li key={i}>· {w}</li>))}
            {report.warnings.length > 10 && <li className="italic">… and {report.warnings.length - 10} more.</li>}
          </ul>
        </div>
      )}

      {report ? (
        <>
          {/* Section 6 Summary tiles — high-level "what do I owe" */}
          <SummaryTiles report={report} />

          {/* Section 3.1 */}
          <SectionCard title="Section 3.1 — Tax on Outward Supplies + RCM Inward">
            <TaxTable rows={[
              { label: "3.1(a) · Outward taxable supplies", block: report.s3_1.a_outward_taxable, highlight: true },
              { label: "3.1(b) · Outward zero-rated (exports / SEZ)", block: report.s3_1.b_zero_rated, dim: true },
              { label: "3.1(c) · Nil-rated / exempted", block: report.s3_1.c_nil_rated_exempt },
              { label: "3.1(d) · Inward supplies (reverse charge)", block: report.s3_1.d_inward_reverse_charge, dim: true },
              { label: "3.1(e) · Non-GST outward supplies", block: report.s3_1.e_non_gst, dim: true },
            ]} />
          </SectionCard>

          {/* Section 3.2 */}
          <SectionCard title="Section 3.2 — Of 3.1(a), Inter-state to Unregistered">
            {report.s3_2.length === 0 ? (
              <div className="p-4 text-sm text-ink-faint text-center">No inter-state UR supplies this period.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-center">POS</th>
                    <th className="th">State</th>
                    <th className="th text-right">Rate %</th>
                    <th className="th text-center">Recipient</th>
                    <th className="th text-right">Taxable</th>
                    <th className="th text-right">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {report.s3_2.map((r, i) => (
                    <tr key={i} className="hover:bg-brand-yellow-50/40">
                      <td className="td text-center font-mono">{r.posCode}</td>
                      <td className="td text-xs">{r.posState}</td>
                      <td className="td text-right font-mono">{r.rate}</td>
                      <td className="td text-center text-[10px] font-bold">{r.recipient}</td>
                      <td className="td text-right font-mono">{fmtINR(r.taxableValue)}</td>
                      <td className="td text-right font-mono">{fmtINR(r.igst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          {/* Section 4 */}
          <SectionCard title="Section 4 — Eligible Input Tax Credit (ITC)">
            <TaxTable rows={[
              { label: "4(A1) · ITC on import of goods", block: report.s4.a1_import_goods, dim: true },
              { label: "4(A2) · ITC on import of services", block: report.s4.a2_import_services, dim: true },
              { label: "4(A3) · ITC on inward supplies under RCM", block: report.s4.a3_reverse_charge, dim: true },
              { label: "4(A4) · ITC received from ISD", block: report.s4.a4_isd, dim: true },
              { label: "4(A5) · All other ITC (from GRNs)", block: report.s4.a5_all_other_itc, highlight: true },
              { label: "4(A) · Total ITC Available", block: report.s4.a_total, bold: true },
              { label: "4(B1) · ITC reversed (Rule 38, 42, 43)", block: report.s4.b1_rule_38_42_43, dim: true },
              { label: "4(B2) · Other ITC reversal", block: report.s4.b2_others, dim: true },
              { label: "4(B) · Total ITC reversed", block: report.s4.b_total, bold: true },
              { label: "4(C) · Net ITC Available (A − B)", block: report.s4.c_net_itc, bold: true, highlight: true },
            ]} />
          </SectionCard>

          <div className="text-xs text-ink-faint print:hidden">
            Dim rows are placeholders for Phase 3+. Highlighted rows are computed from your data.
          </div>
        </>
      ) : (
        <div className="card p-6 text-center text-ink-mid">
          No report yet — pick a period and click <strong>Regenerate</strong>.
        </div>
      )}
    </div>
  );
}

function SummaryTiles({ report }: { report: SerializedReport }) {
  const o = report.s6_summary.outputTaxTotal;
  const i = report.s6_summary.inputItcTotal;
  const n = report.s6_summary.netPayable;
  const totalOut = o.igst + o.cgst + o.sgst + o.cess;
  const totalIn = i.igst + i.cgst + i.sgst + i.cess;
  const totalNet = n.igst + n.cgst + n.sgst + n.cess;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="card p-4">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Output Tax (3.1 a+b)</div>
        <div className="mt-1 font-mono text-2xl font-bold text-rose-700">₹{fmtINR(totalOut)}</div>
        <div className="text-[10px] text-ink-mid mt-1">CGST ₹{fmtINR(o.cgst)} · SGST ₹{fmtINR(o.sgst)} · IGST ₹{fmtINR(o.igst)}</div>
      </div>
      <div className="card p-4">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Net ITC (4.C)</div>
        <div className="mt-1 font-mono text-2xl font-bold text-emerald-700">₹{fmtINR(totalIn)}</div>
        <div className="text-[10px] text-ink-mid mt-1">CGST ₹{fmtINR(i.cgst)} · SGST ₹{fmtINR(i.sgst)} · IGST ₹{fmtINR(i.igst)}</div>
      </div>
      <div className="card p-4">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Net Cash Payable</div>
        <div className={`mt-1 font-mono text-2xl font-bold ${totalNet > 0 ? "text-amber-700" : "text-emerald-700"}`}>₹{fmtINR(totalNet)}</div>
        <div className="text-[10px] text-ink-mid mt-1">{totalNet < 0 ? "Excess ITC carried forward" : "Pay this in Cash ledger"}</div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">{title}</div>
      {children}
    </div>
  );
}

function TaxTable({ rows }: { rows: Array<{ label: string; block: TaxBlock; highlight?: boolean; dim?: boolean; bold?: boolean }> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="th">Row</th>
          <th className="th text-right">Taxable</th>
          <th className="th text-right">IGST</th>
          <th className="th text-right">CGST</th>
          <th className="th text-right">SGST</th>
          <th className="th text-right">CESS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cls = [
            r.dim ? "text-ink-faint" : "",
            r.bold ? "font-bold" : "",
            r.highlight ? "bg-brand-yellow-50/40" : "",
          ].join(" ");
          return (
            <tr key={i} className={cls}>
              <td className="td">{r.label}</td>
              <td className="td text-right font-mono">{fmtINR(r.block.taxableValue)}</td>
              <td className="td text-right font-mono">{fmtINR(r.block.igst)}</td>
              <td className="td text-right font-mono">{fmtINR(r.block.cgst)}</td>
              <td className="td text-right font-mono">{fmtINR(r.block.sgst)}</td>
              <td className="td text-right font-mono">{fmtINR(r.block.cess)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function csvRow(label: string, b: TaxBlock): string {
  return [csvField(label), b.taxableValue, b.igst, b.cgst, b.sgst, b.cess].join(",");
}

function csvField(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
