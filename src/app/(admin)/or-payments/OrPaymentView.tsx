"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { createOrPayment, deleteOrPayment } from "./actions";
import { Banknote, Download, Plus, Trash2, X, ExternalLink } from "lucide-react";
import type { OrRow } from "./page";

export function OrPaymentView({
  vendors,
  selectedVendor,
  rows,
  summary,
  initialVendorId,
}: {
  vendors: { id: string; code: string | null; name: string }[];
  selectedVendor: { code: string | null; name: string } | null;
  rows: OrRow[];
  summary: { balance: number; overdue: number; billed: number; paid: number };
  initialVendorId: string;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [creating, setCreating] = useState(false);
  const today = new Date();

  const onSelect = (id: string) => {
    setVendorId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("vendorId", id);
    else url.searchParams.delete("vendorId");
    router.push(url.pathname + url.search);
  };

  const onDeletePayment = async (id: string) => {
    if (!window.confirm("Delete this payment entry?")) return;
    const res = await deleteOrPayment(id);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success("Payment deleted");
    router.refresh();
  };

  const onExport = () => {
    if (!selectedVendor) return;
    const csv = toCsv(
      rows.map((r) => ({
        Date: toDisplayDate(r.date),
        "Invoice Date": r.invoiceDate ? toDisplayDate(r.invoiceDate) : "",
        "GRN Date": r.grnDate ? toDisplayDate(r.grnDate) : "",
        "Doc No": r.docNo,
        Particulars: r.particulars,
        Due: r.dueDate ? toDisplayDate(r.dueDate) : "",
        Debit: r.debit.toFixed(2),
        Credit: r.credit.toFixed(2),
        Balance: r.balance.toFixed(2),
      })),
    );
    downloadCsv(`or-payment-${selectedVendor.code ?? selectedVendor.name}.csv`, csv);
  };

  return (
    <>
      <div className="mb-4 card p-3 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Vendor</div>
        <select value={vendorId} onChange={(e) => onSelect(e.target.value)} className="input max-w-md">
          <option value="">— pick a vendor —</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        {selectedVendor && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setCreating(true)} className="btn-primary inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Record payment
            </button>
            {rows.length > 0 && (
              <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
            )}
          </div>
        )}
      </div>

      {!selectedVendor ? (
        <div className="card p-10 text-center text-ink-faint">
          <Banknote className="h-12 w-12 mx-auto opacity-40 mb-3" />
          <div className="text-sm">Select a vendor to view their OR account.</div>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">OR Billed</div>
              <div className="font-display text-2xl font-bold tabular-nums">{summary.billed.toFixed(2)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Paid</div>
              <div className="font-display text-2xl font-bold tabular-nums">{summary.paid.toFixed(2)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Balance</div>
              <div className={`font-display text-2xl font-bold tabular-nums ${summary.balance > 0.01 ? "text-amber-700" : "text-green-700"}`}>{summary.balance.toFixed(2)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Overdue</div>
              <div className={`font-display text-2xl font-bold tabular-nums ${summary.overdue > 0.01 ? "text-red-700" : "text-green-700"}`}>{summary.overdue.toFixed(2)}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Invoice Date</th>
                  <th className="th">GRN Date</th>
                  <th className="th">Doc No</th>
                  <th className="th">Particulars</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Debit</th>
                  <th className="th text-right">Credit</th>
                  <th className="th text-right">Balance</th>
                  <th className="th text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="td text-center text-ink-faint py-8">No OR activity for this vendor.</td></tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-brand-yellow-50/40">
                      <td className="td whitespace-nowrap">{toDisplayDate(r.date)}</td>
                      <td className="td whitespace-nowrap">{r.invoiceDate ? toDisplayDate(r.invoiceDate) : "—"}</td>
                      <td className="td whitespace-nowrap">{r.grnDate ? toDisplayDate(r.grnDate) : "—"}</td>
                      <td className="td font-mono text-xs">
                        {r.grnId ? (
                          <Link href={`/grn/${r.grnId}`} className="inline-flex items-center gap-1 text-brand-yellow-dark hover:underline" title="Open this GRN">
                            {r.docNo} <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          r.docNo
                        )}
                      </td>
                      <td className="td">{r.particulars}</td>
                      <td className={`td whitespace-nowrap text-xs ${r.credit > 0 && r.dueDate && new Date(r.dueDate) < today ? "text-red-700 font-semibold" : "text-ink-faint"}`}>
                        {r.dueDate ? toDisplayDate(r.dueDate) : "—"}
                      </td>
                      <td className="td text-right tabular-nums">{r.debit > 0 ? r.debit.toFixed(2) : "—"}</td>
                      <td className="td text-right tabular-nums">{r.credit > 0 ? r.credit.toFixed(2) : "—"}</td>
                      <td className="td text-right tabular-nums font-medium">{r.balance.toFixed(2)}</td>
                      <td className="td text-right">
                        {r.kind === "payment" && (
                          <button type="button" onClick={() => onDeletePayment(r.id)} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete payment">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {creating && selectedVendor && (
        <PaymentModal
          vendorId={vendorId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function PaymentModal({ vendorId, onClose, onSaved }: { vendorId: string; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createOrPayment(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Payment recorded");
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Record OR payment</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted"><X className="h-4 w-4" /></button>
        </div>
        <input type="hidden" name="vendorId" value={vendorId} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date <span className="text-red-600">*</span></label>
            <input name="date" type="date" defaultValue={today} required className="input mt-1" />
            {errors.date && <p className="mt-1 text-xs text-rose-600">{errors.date}</p>}
          </div>
          <div>
            <label className="label">Amount <span className="text-red-600">*</span></label>
            <input name="amount" type="number" min="0" step="0.01" required autoFocus className="input mt-1 text-right tabular-nums" />
            {errors.amount && <p className="mt-1 text-xs text-rose-600">{errors.amount}</p>}
          </div>
          <div className="col-span-2">
            <label className="label">Reference (UTR / cheque)</label>
            <input name="reference" className="input mt-1" />
          </div>
          <div className="col-span-2">
            <label className="label">Particulars</label>
            <input name="particulars" className="input mt-1" placeholder="e.g. NEFT settlement for April invoices" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Record payment"}</button>
        </div>
      </form>
    </div>
  );
}
