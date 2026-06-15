"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { createOtherCharge, deleteOtherCharge } from "./actions";
import { Plus, Download, Trash2, X, Receipt } from "lucide-react";

type Vendor = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type Row = {
  id: string;
  chargeNo: string;
  date: Date | string;
  direction: string;
  model: string | null;
  vendorCode: string | null;
  vendorName: string;
  reason: string;
  taxable: number;
  gstRate: number;
  gst: number;
  total: number;
  notes: string | null;
};

export function OtherChargesView({
  vendors,
  models,
  rows,
  debitTotal,
  creditTotal,
  initialVendorId,
}: {
  vendors: Vendor[];
  models: ModelOption[];
  rows: Row[];
  debitTotal: number;
  creditTotal: number;
  initialVendorId: string;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [creating, setCreating] = useState(false);

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace(/_/g, "-")) : "—";

  const onFilter = (id: string) => {
    setVendorId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("vendorId", id);
    else url.searchParams.delete("vendorId");
    router.push(url.pathname + url.search);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        "Note No": r.chargeNo,
        Type: r.direction === "CREDIT" ? "Credit Note" : "Debit Note",
        Date: toDisplayDate(r.date),
        "Vendor Code": r.vendorCode ?? "",
        Vendor: r.vendorName,
        Model: r.model ?? "",
        Reason: r.reason,
        Taxable: r.taxable.toFixed(2),
        "GST %": r.gstRate.toFixed(2),
        GST: r.gst.toFixed(2),
        Total: r.total.toFixed(2),
        Notes: r.notes ?? "",
      })),
      ["Note No", "Type", "Date", "Vendor Code", "Vendor", "Model", "Reason", "Taxable", "GST %", "GST", "Total", "Notes"],
    );
    downloadCsv("debit-credit-notes.csv", csv);
  };

  const onDelete = async (id: string, chargeNo: string) => {
    if (!window.confirm(`Delete note ${chargeNo}? This cannot be undone.`)) return;
    const res = await deleteOtherCharge(id);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`${chargeNo} deleted`);
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={vendorId} onChange={(e) => onFilter(e.target.value)} className="input max-w-xs">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => setCreating(true)} className="btn-primary inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Debit / Credit Note
        </button>
        <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-line bg-amber-50 px-4 py-2">
          <span className="text-ink-faint">Debit (reduces owed):&nbsp;</span>
          <span className="font-semibold tabular-nums text-amber-800">{debitTotal.toFixed(2)}</span>
        </div>
        <div className="rounded-lg border border-line bg-orange-50 px-4 py-2">
          <span className="text-ink-faint">Credit (increases owed):&nbsp;</span>
          <span className="font-semibold tabular-nums text-orange-800">{creditTotal.toFixed(2)}</span>
        </div>
        <div className="rounded-lg border border-line bg-surface-muted px-4 py-2">
          <span className="text-ink-faint">Net effect on balance:&nbsp;</span>
          <span className="font-semibold tabular-nums">{(creditTotal - debitTotal).toFixed(2)}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Note No</th>
              <th className="th">Type</th>
              <th className="th">Date</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th">Reason</th>
              <th className="th text-right">Taxable</th>
              <th className="th text-right">GST</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Receipt className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No notes recorded.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isCredit = r.direction === "CREDIT";
                return (
                  <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono text-xs">{r.chargeNo}</td>
                    <td className="td">
                      <span className={`badge ${isCredit ? "border-orange-300 bg-orange-50 text-orange-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                        {isCredit ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td className="td">{toDisplayDate(r.date)}</td>
                    <td className="td">
                      <div>{r.vendorName}</div>
                      <div className="text-[10px] text-ink-faint font-mono">{r.vendorCode ?? "—"}</div>
                    </td>
                    <td className="td">{modelLabel(r.model)}</td>
                    <td className="td">
                      {r.reason}
                      {r.notes && <div className="text-[11px] text-ink-faint">{r.notes}</div>}
                    </td>
                    <td className="td text-right tabular-nums">{r.taxable.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{r.gst.toFixed(2)}</td>
                    <td className={`td text-right tabular-nums font-medium ${isCredit ? "text-orange-800" : "text-amber-800"}`}>
                      {isCredit ? "+" : "−"}{r.total.toFixed(2)}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end">
                        <button type="button" onClick={() => onDelete(r.id, r.chargeNo)} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <NoteModal
          vendors={vendors}
          models={models}
          defaultVendorId={vendorId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function NoteModal({
  vendors,
  models,
  defaultVendorId,
  onClose,
  onSaved,
}: {
  vendors: Vendor[];
  models: ModelOption[];
  defaultVendorId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [taxable, setTaxable] = useState("");
  const [gstRate, setGstRate] = useState("0");

  const preview = useMemo(() => {
    const t = parseFloat(taxable) || 0;
    const r = parseFloat(gstRate) || 0;
    const gst = (t * r) / 100;
    return { gst, total: t + gst };
  }, [taxable, gstRate]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createOtherCharge(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(`Note ${res.chargeNo} recorded`);
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">New Debit / Credit Note</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setDirection("DEBIT")} className={`rounded border px-3 py-2 text-sm font-medium ${direction === "DEBIT" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-line text-ink-mid"}`}>
            Debit Note <span className="block text-[10px] font-normal">reduces what we owe</span>
          </button>
          <button type="button" onClick={() => setDirection("CREDIT")} className={`rounded border px-3 py-2 text-sm font-medium ${direction === "CREDIT" ? "border-orange-400 bg-orange-50 text-orange-900" : "border-line text-ink-mid"}`}>
            Credit Note <span className="block text-[10px] font-normal">increases what we owe</span>
          </button>
        </div>
        <input type="hidden" name="direction" value={direction} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Date <span className="text-red-600">*</span></label>
            <input name="date" type="date" defaultValue={today} required className="input mt-1" />
            {errors.date && <p className="mt-1 text-xs text-rose-600">{errors.date}</p>}
          </div>
          <div>
            <label className="label">Vendor <span className="text-red-600">*</span></label>
            <select name="vendorId" defaultValue={defaultVendorId} required className="input mt-1">
              <option value="">— pick vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
            </select>
            {errors.vendorId && <p className="mt-1 text-xs text-rose-600">{errors.vendorId}</p>}
          </div>
          <div>
            <label className="label">Model <span className="text-red-600">*</span></label>
            <select name="model" required className="input mt-1">
              <option value="">— select model —</option>
              {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
            {errors.model && <p className="mt-1 text-xs text-rose-600">{errors.model}</p>}
          </div>
          <div>
            <label className="label">Reason <span className="text-red-600">*</span></label>
            <input name="reason" required className="input mt-1" placeholder="e.g. Price adjustment, penalty…" />
            {errors.reason && <p className="mt-1 text-xs text-rose-600">{errors.reason}</p>}
          </div>
          <div>
            <label className="label">Taxable amount <span className="text-red-600">*</span></label>
            <input name="taxable" type="number" min="0" step="0.01" value={taxable} onChange={(e) => setTaxable(e.target.value)} required className="input mt-1 text-right tabular-nums" />
            {errors.taxable && <p className="mt-1 text-xs text-rose-600">{errors.taxable}</p>}
          </div>
          <div>
            <label className="label">GST %</label>
            <input name="gstRate" type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="input mt-1 text-right tabular-nums" />
            {errors.gstRate && <p className="mt-1 text-xs text-rose-600">{errors.gstRate}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <textarea name="notes" className="input mt-1 min-h-[56px]" />
          </div>
        </div>

        <div className="mt-3 flex gap-6 rounded border border-brand-yellow-light bg-brand-yellow-50 px-4 py-2 text-sm tabular-nums">
          <span>GST <b>{preview.gst.toFixed(2)}</b></span>
          <span>Total <b>{preview.total.toFixed(2)}</b></span>
          <span className="text-ink-faint">{direction === "CREDIT" ? "increases" : "reduces"} balance owed</span>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Record note"}</button>
        </div>
      </form>
    </div>
  );
}
