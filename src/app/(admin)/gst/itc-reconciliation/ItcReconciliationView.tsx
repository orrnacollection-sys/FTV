"use client";
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { Upload, Zap, Link2, Link2Off, Ban, AlertTriangle, FileJson } from "lucide-react";
import {
  importGSTR2B,
  autoMatchItc,
  matchItcLine,
  unmatchItcLine,
  ignoreItcLine,
} from "../itc-actions";

type GstinOption = { gstin: string; state: string; isDefault: boolean };

type Line = {
  id: string;
  vendorGstin: string;
  vendorName: string | null;
  invoiceNo: string;
  invoiceDate: string;
  invoiceType: string;
  invoiceValue: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  matchStatus: string;
  matchedGrn: { id: string; grnNo: string; grnDate: string; total: number } | null;
};

type Grn = {
  id: string;
  grnNo: string;
  grnDate: string;
  vendorInvoiceNo: string | null;
  vendorInvoiceDate: string | null;
  total: number;
  taxable: number;
  tax: number;
  vendorName: string;
  vendorGstin: string | null;
};

type Summary = {
  total2BLines: number;
  totalGrns: number;
  matched: number;
  unmatchedLines: number;
  unmatchedGrns: number;
  ignoredLines: number;
  eligibleItcTax: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  bookItcTaxMatched: number;
  bookItcTaxAll: number;
  atRiskTax: number;
};

type Tab = "all" | "missing_books" | "missing_portal" | "matched" | "ignored";

const TAB_LABELS: Record<Tab, string> = {
  all: "All 2B lines",
  missing_books: "Missing in Books",
  missing_portal: "Missing in Portal",
  matched: "Matched",
  ignored: "Ignored",
};

export function ItcReconciliationView({
  gstins,
  initialPeriod,
  initialGstin,
  summary,
  lines,
  unmatchedGrns,
}: {
  gstins: GstinOption[];
  initialPeriod: string;
  initialGstin: string;
  summary: Summary;
  lines: Line[];
  unmatchedGrns: Grn[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [period, setPeriod] = useState(initialPeriod);
  const [gstin, setGstin] = useState(initialGstin);
  const [tab, setTab] = useState<Tab>("all");
  const [matchTarget, setMatchTarget] = useState<Line | null>(null);

  function navigate(p = period, g = gstin) {
    const params = new URLSearchParams();
    params.set("period", p);
    params.set("gstin", g);
    router.push(`/gst/itc-reconciliation?${params.toString()}`);
    router.refresh();
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "json" | "csv") {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      startTransition(async () => {
        const r = await importGSTR2B({
          kind,
          text,
          filingGstin: kind === "csv" ? gstin : undefined,
          period: kind === "csv" ? period : undefined,
          dedupeKey: `${file.name}|${file.size}`,
        });
        if (!("ok" in r) || !r.ok) {
          toast.error("error" in r ? r.error : "Import failed");
          return;
        }
        toast.success(`Imported ${r.imported} lines for ${r.period}`);
        if (r.errors.length > 0) console.warn("Import warnings:", r.errors);
        if (r.period !== period || r.filingGstin !== gstin) {
          setPeriod(r.period); setGstin(r.filingGstin);
          navigate(r.period, r.filingGstin);
        } else {
          navigate();
        }
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function runAutoMatch() {
    startTransition(async () => {
      const r = await autoMatchItc({ filingGstin: gstin, period });
      if (!("ok" in r) || !r.ok) {
        toast.error("error" in r ? r.error : "Auto-match failed");
        return;
      }
      toast.success(`Proposed ${r.proposed}, matched ${r.matched}`);
      navigate();
    });
  }

  function ignore(lineId: string) {
    startTransition(async () => {
      const r = await ignoreItcLine(lineId);
      if ("error" in r) toast.error(r.error);
      else toast.success("Ignored");
      navigate();
    });
  }

  function unmatch(lineId: string) {
    startTransition(async () => {
      const r = await unmatchItcLine(lineId);
      if ("error" in r) toast.error(r.error);
      else toast.success("Unmatched");
      navigate();
    });
  }

  const filteredLines = useMemo(() => {
    if (tab === "missing_books") return lines.filter((l) => l.matchStatus === "UNMATCHED");
    if (tab === "matched") return lines.filter((l) => l.matchStatus === "MATCHED");
    if (tab === "ignored") return lines.filter((l) => l.matchStatus === "IGNORED");
    return lines;
  }, [tab, lines]);

  const totalGstFromBooks = round2(summary.bookItcTaxAll);
  const eligible = summary.eligibleItcTax;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Period</span>
          <input type="month" className="input" value={period} onChange={(e) => { setPeriod(e.target.value); navigate(e.target.value, gstin); }} />
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Filing GSTIN</span>
          <select className="input" value={gstin} onChange={(e) => { setGstin(e.target.value); navigate(period, e.target.value); }}>
            {gstins.map((g) => (
              <option key={g.gstin} value={g.gstin}>{g.gstin} · {g.state}{g.isDefault ? " (default)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="btn-ghost flex items-center gap-1.5 cursor-pointer">
          <FileJson className="h-4 w-4" /> Import 2B JSON
          <input type="file" accept=".json" className="hidden" onChange={(e) => onUpload(e, "json")} disabled={busy} />
        </label>
        <label className="btn-ghost flex items-center gap-1.5 cursor-pointer">
          <Upload className="h-4 w-4" /> Import 2B CSV
          <input type="file" accept=".csv" className="hidden" onChange={(e) => onUpload(e, "csv")} disabled={busy} />
        </label>
        <button onClick={runAutoMatch} className="btn-primary flex items-center gap-1.5" disabled={busy || summary.total2BLines === 0}>
          <Zap className="h-4 w-4" /> {busy ? "Working…" : "Auto-Match"}
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total 2B Lines" value={summary.total2BLines.toString()} sub={`${summary.totalGrns} GRNs in books`} />
        <Tile label="Matched" value={summary.matched.toString()} sub={`₹${fmtINR(summary.bookItcTaxMatched)} confirmed`} tone="ok" />
        <Tile label="Missing in Books" value={summary.unmatchedLines.toString()} sub="Vendor reported, not posted" tone={summary.unmatchedLines > 0 ? "warn" : "ok"} />
        <Tile label="Missing in Portal" value={summary.unmatchedGrns.toString()} sub="Posted, not reported" tone={summary.unmatchedGrns > 0 ? "warn" : "ok"} />
      </div>

      {/* Eligible ITC card */}
      <div className="card">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">Eligible ITC (this period)</div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <KPI label="CGST" value={`₹${fmtINR(eligible.cgst)}`} />
          <KPI label="SGST" value={`₹${fmtINR(eligible.sgst)}`} />
          <KPI label="IGST" value={`₹${fmtINR(eligible.igst)}`} />
          <KPI label="CESS" value={`₹${fmtINR(eligible.cess)}`} />
          <KPI label="Total Eligible" value={`₹${fmtINR(eligible.total)}`} bold />
        </div>
        {summary.atRiskTax > 0.01 && (
          <div className="border-t border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <strong>₹{fmtINR(summary.atRiskTax)} at risk</strong> — booked in GSTR-3B 4(A5) but no matching 2B line (total booked ₹{fmtINR(totalGstFromBooks)} vs matched ₹{fmtINR(summary.bookItcTaxMatched)}).
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border flex gap-0 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
          const count = t === "missing_books" ? summary.unmatchedLines
            : t === "missing_portal" ? summary.unmatchedGrns
            : t === "matched" ? summary.matched
            : t === "ignored" ? summary.ignoredLines
            : summary.total2BLines;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition ${tab === t ? "border-brand-yellow text-ink" : "border-transparent text-ink-mid hover:text-ink"}`}
            >
              {TAB_LABELS[t]} ({count})
            </button>
          );
        })}
      </div>

      {tab === "missing_portal" ? (
        <MissingPortalTable rows={unmatchedGrns} />
      ) : (
        <LinesTable
          rows={filteredLines}
          onMatch={(l) => setMatchTarget(l)}
          onIgnore={ignore}
          onUnmatch={unmatch}
        />
      )}

      {matchTarget && (
        <MatchModal
          line={matchTarget}
          grns={unmatchedGrns}
          onClose={() => setMatchTarget(null)}
          onConfirm={(grnId) => {
            startTransition(async () => {
              const r = await matchItcLine({ lineId: matchTarget.id, grnId });
              if ("error" in r) toast.error(r.error);
              else {
                toast.success("Matched");
                setMatchTarget(null);
                navigate();
              }
            });
          }}
        />
      )}
    </div>
  );
}

function LinesTable({
  rows,
  onMatch,
  onIgnore,
  onUnmatch,
}: {
  rows: Line[];
  onMatch: (l: Line) => void;
  onIgnore: (id: string) => void;
  onUnmatch: (id: string) => void;
}) {
  return (
    <div className="card">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">Vendor GSTIN · Name</th>
            <th className="th">Invoice No</th>
            <th className="th">Date</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">CGST</th>
            <th className="th text-right">SGST</th>
            <th className="th text-right">IGST</th>
            <th className="th text-right">Total</th>
            <th className="th text-center">Status</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="td text-center py-6 text-ink-faint">No rows in this tab.</td></tr>
          ) : (
            rows.map((l) => (
              <tr key={l.id} className="hover:bg-brand-yellow-50/40">
                <td className="td">
                  <div className="font-mono">{l.vendorGstin}</div>
                  {l.vendorName && <div className="text-ink-mid">{l.vendorName}</div>}
                </td>
                <td className="td font-mono">{l.invoiceNo}</td>
                <td className="td">{fmtDate(l.invoiceDate)}</td>
                <td className="td text-right font-mono">{fmtINR(l.taxableValue)}</td>
                <td className="td text-right font-mono">{fmtINR(l.cgst)}</td>
                <td className="td text-right font-mono">{fmtINR(l.sgst)}</td>
                <td className="td text-right font-mono">{fmtINR(l.igst)}</td>
                <td className="td text-right font-mono font-bold">{fmtINR(l.invoiceValue)}</td>
                <td className="td text-center">
                  <StatusPill status={l.matchStatus} matched={l.matchedGrn?.grnNo ?? null} />
                </td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1">
                    {l.matchStatus === "UNMATCHED" && (
                      <>
                        <button onClick={() => onMatch(l)} className="rounded p-1 hover:bg-brand-yellow-pale" title="Match"><Link2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => onIgnore(l.id)} className="rounded p-1 hover:bg-gray-100" title="Ignore"><Ban className="h-3.5 w-3.5 text-ink-mid" /></button>
                      </>
                    )}
                    {l.matchStatus === "MATCHED" && (
                      <button onClick={() => onUnmatch(l.id)} className="rounded p-1 hover:bg-rose-50" title="Unmatch"><Link2Off className="h-3.5 w-3.5 text-rose-600" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MissingPortalTable({ rows }: { rows: Grn[] }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-xs">
        GRNs posted in your books but not appearing in the portal&apos;s 2B.
        Follow up with vendor — they may not have filed GSTR-1 yet.
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">GRN</th>
            <th className="th">Date</th>
            <th className="th">Vendor · GSTIN</th>
            <th className="th">Vendor Inv No</th>
            <th className="th text-right">Taxable</th>
            <th className="th text-right">Tax</th>
            <th className="th text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="td text-center py-6 text-ink-faint">All booked GRNs are in the portal.</td></tr>
          ) : (
            rows.map((g) => (
              <tr key={g.id} className="hover:bg-brand-yellow-50/40">
                <td className="td font-mono">{g.grnNo}</td>
                <td className="td">{fmtDate(g.grnDate)}</td>
                <td className="td">
                  <div>{g.vendorName}</div>
                  {g.vendorGstin && <div className="font-mono text-ink-mid">{g.vendorGstin}</div>}
                </td>
                <td className="td font-mono">{g.vendorInvoiceNo ?? "—"}</td>
                <td className="td text-right font-mono">{fmtINR(g.taxable)}</td>
                <td className="td text-right font-mono">{fmtINR(g.tax)}</td>
                <td className="td text-right font-mono font-bold">{fmtINR(g.total)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchModal({
  line,
  grns,
  onClose,
  onConfirm,
}: {
  line: Line;
  grns: Grn[];
  onClose: () => void;
  onConfirm: (grnId: string) => void;
}) {
  const lineTax = line.cgst + line.sgst + line.igst + line.cess;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lineKey = norm(line.invoiceNo);
  const sorted = useMemo(() => {
    return [...grns]
      .map((g) => {
        const taxDiff = Math.abs(g.tax - lineTax);
        const valDiff = Math.abs(g.total - line.invoiceValue);
        const gstinMatch = g.vendorGstin === line.vendorGstin;
        const invMatch = g.vendorInvoiceNo ? norm(g.vendorInvoiceNo) === lineKey : false;
        const score = (gstinMatch ? 0 : 10) + (invMatch ? 0 : 5) + taxDiff * 0.1 + valDiff * 0.01;
        return { g, score, taxDiff, valDiff, gstinMatch, invMatch };
      })
      .sort((a, b) => a.score - b.score);
  }, [grns, lineTax, line.invoiceValue, line.vendorGstin, lineKey]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="card max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-2">
          <span className="text-sm font-bold">Match 2B line to a GRN</span>
          <button onClick={onClose} className="ml-auto text-xs text-ink-mid hover:text-ink">Esc</button>
        </div>
        <div className="px-4 py-3 border-b border-border bg-paper-cream/40 text-sm">
          <div className="font-mono">{line.vendorGstin} · Inv {line.invoiceNo} · {fmtDate(line.invoiceDate)}</div>
          <div className="text-ink-mid">{line.vendorName ?? ""} · Tax ₹{fmtINR(lineTax)} · Total ₹{fmtINR(line.invoiceValue)}</div>
        </div>
        <div className="overflow-auto flex-1">
          {sorted.length === 0 ? (
            <div className="p-6 text-center text-ink-mid text-sm">No unmatched GRNs to choose from.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="th">Pick</th>
                  <th className="th">GRN</th>
                  <th className="th">Date</th>
                  <th className="th">Vendor · GSTIN</th>
                  <th className="th">Vendor Inv</th>
                  <th className="th text-right">Tax</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ g, taxDiff, valDiff, gstinMatch, invMatch }) => (
                  <tr key={g.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td"><button onClick={() => onConfirm(g.id)} className="btn-primary text-xs py-0.5 px-2">Pick</button></td>
                    <td className="td font-mono">{g.grnNo}</td>
                    <td className="td">{fmtDate(g.grnDate)}</td>
                    <td className="td">
                      <div>{g.vendorName}</div>
                      {g.vendorGstin && (
                        <div className={`font-mono text-[10px] ${gstinMatch ? "text-emerald-700 font-bold" : "text-ink-mid"}`}>
                          {g.vendorGstin}{gstinMatch ? " ✓" : ""}
                        </div>
                      )}
                    </td>
                    <td className={`td font-mono ${invMatch ? "text-emerald-700 font-bold" : ""}`}>{g.vendorInvoiceNo ?? "—"}{invMatch ? " ✓" : ""}</td>
                    <td className={`td text-right font-mono ${taxDiff < 0.01 ? "text-emerald-700 font-bold" : ""}`}>{fmtINR(g.tax)}{taxDiff > 0.01 ? <span className="text-[10px] text-ink-mid"> (Δ {fmtINR(taxDiff)})</span> : null}</td>
                    <td className={`td text-right font-mono ${valDiff < 0.01 ? "text-emerald-700 font-bold" : ""}`}>{fmtINR(g.total)}{valDiff > 0.01 ? <span className="text-[10px] text-ink-mid"> (Δ {fmtINR(valDiff)})</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`card p-3 ${tone === "warn" ? "border-amber-300" : tone === "ok" ? "border-emerald-300" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-mid mt-0.5">{sub}</div>}
    </div>
  );
}

function KPI({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</div>
      <div className={`mt-0.5 font-mono ${bold ? "text-lg font-bold" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status, matched }: { status: string; matched: string | null }) {
  if (status === "MATCHED") {
    return <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{matched ?? "MATCHED"}</span>;
  }
  if (status === "IGNORED") {
    return <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">IGNORED</span>;
  }
  return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">UNMATCHED</span>;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
