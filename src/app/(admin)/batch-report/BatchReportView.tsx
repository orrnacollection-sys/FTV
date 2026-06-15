"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toDisplayDate, toIsoDate } from "@/lib/date";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { updateBatch, importBatchRemarks, emailBatchReport } from "./actions";
import { Search, Download, Upload, Eye, Pencil, Mail, Undo2, X, Boxes } from "lucide-react";
import type { BatchSummaryRow } from "@/lib/batch-report";

type Vendor = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type Filters = { q: string; model: string; vendorId: string; from: string; to: string };

export function BatchReportView({
  rows,
  vendors,
  models,
  initial,
}: {
  rows: BatchSummaryRow[];
  vendors: Vendor[];
  models: ModelOption[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [editing, setEditing] = useState<BatchSummaryRow | null>(null);
  const [importing, startImport] = useTransition();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = new Date();

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace(/_/g, "-")) : "—";

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "model", "vendorId", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        "Batch No": r.batchNo, Type: r.type, "Inward Date": toDisplayDate(r.inwardDate),
        Expiry: r.expiry ? toDisplayDate(r.expiry) : "", Vendor: r.vendorName, Model: r.model ?? "",
        "Total Inward": r.totalInward.toFixed(2), "Total Sale": r.totalSale.toFixed(2), "Total RTO": r.totalRTO.toFixed(2),
        Return: r.totalReturn.toFixed(2), Net: r.net.toFixed(2), "% Return": r.pctReturn.toFixed(1), "Bal Qty": r.balQty.toFixed(2),
        "Review Date": r.reviewDate ? toDisplayDate(r.reviewDate) : "", Remarks: r.remarks ?? "",
      })),
    );
    downloadCsv("batch-summary.csv", csv);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await importBatchRemarks(csvRows);
      const msg = `${res.updated} updated` + (res.errors.length ? `, ${res.errors.length} errors` : "");
      if (res.errors.length) toast.error(`${msg} — ${res.errors.slice(0, 3).join(" | ")}`);
      else toast.success(msg);
      router.refresh();
    });
  };

  const onEmail = (grnId: string) => {
    startTransition(async () => {
      const res = await emailBatchReport(grnId);
      if ("error" in res) toast.error(res.error);
      else toast.success("Batch report emailed to vendor");
    });
  };

  return (
    <>
      <form onSubmit={onApply} className="mb-3 card p-3 grid grid-cols-1 gap-2 md:grid-cols-6">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="Batch no / vendor" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
        </div>
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} className="input">
          <option value="">All models</option>
          {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" title="Inward from" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" title="Inward to" />
        <div className="md:col-span-6 flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-primary">Apply filters</button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onImport(file); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import Remarks"}
          </button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Download CSV</button>
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Batch No</th>
              <th className="th">Inward</th>
              <th className="th">Expiry</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th text-right">Inward Qty</th>
              <th className="th text-right">Sale</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">% Ret</th>
              <th className="th text-right">Bal Qty</th>
              <th className="th">Review</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Boxes className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No batches match.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const expired = r.expiry && new Date(r.expiry) < today;
                return (
                  <tr key={r.grnId} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono text-xs">
                      {r.batchNo}
                      {r.type === "RFV" && <span className="ml-1 badge border-sky-200 bg-sky-50 text-sky-700 !py-0 !text-[9px]">RFV</span>}
                      {r.remarks && <div className="text-[10px] text-ink-faint font-sans normal-case">{r.remarks}</div>}
                    </td>
                    <td className="td whitespace-nowrap">{toDisplayDate(r.inwardDate)}</td>
                    <td className={`td whitespace-nowrap ${expired ? "text-red-700 font-semibold" : ""}`}>{r.expiry ? toDisplayDate(r.expiry) : "—"}</td>
                    <td className="td">{r.vendorName}</td>
                    <td className="td">{modelLabel(r.model)}</td>
                    <td className="td text-right tabular-nums">{r.totalInward.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{r.totalSale.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{r.totalRTO.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{r.totalReturn.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{r.pctReturn.toFixed(1)}%</td>
                    <td className="td text-right tabular-nums font-bold">{r.balQty.toFixed(2)}</td>
                    <td className="td whitespace-nowrap text-xs">{r.reviewDate ? toDisplayDate(r.reviewDate) : "—"}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/batch-report/${r.grnId}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="SKU-wise report"><Eye className="h-4 w-4" /></Link>
                        <button type="button" onClick={() => setEditing(r)} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit review/remarks/validity"><Pencil className="h-4 w-4" /></button>
                        <Link href="/rtv/new" className="rounded p-1.5 hover:bg-red-50 text-red-700" title="Create RTV (Reject Out)"><Undo2 className="h-4 w-4" /></Link>
                        <button type="button" onClick={() => onEmail(r.grnId)} disabled={pending} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Email report to vendor"><Mail className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </>
  );
}

function EditModal({ row, onClose, onSaved }: { row: BatchSummaryRow; onClose: () => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updateBatch(fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Batch updated");
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Batch {row.batchNo}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted"><X className="h-4 w-4" /></button>
        </div>
        <input type="hidden" name="grnId" value={row.grnId} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Validity (Expiry)</label>
            <input name="expiry" type="date" defaultValue={row.expiry ? toIsoDate(row.expiry) : ""} className="input mt-1" />
            {errors.expiry && <p className="mt-1 text-xs text-rose-600">{errors.expiry}</p>}
            <p className="mt-1 text-[11px] text-ink-faint">Extend validity for all SKUs in this batch.</p>
          </div>
          <div>
            <label className="label">Review Date</label>
            <input name="reviewDate" type="date" defaultValue={row.reviewDate ? toIsoDate(row.reviewDate) : ""} className="input mt-1" />
            {errors.reviewDate && <p className="mt-1 text-xs text-rose-600">{errors.reviewDate}</p>}
          </div>
          <div className="col-span-2">
            <label className="label">Remarks</label>
            <textarea name="remarks" defaultValue={row.remarks ?? ""} className="input mt-1 min-h-[60px]" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
