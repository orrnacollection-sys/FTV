"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { toDisplayDate, toIsoDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { toast } from "@/components/Toast";
import { upsertPaymentStatus } from "./actions";
import { Search, Download, CreditCard, Banknote, Pencil, X, Receipt } from "lucide-react";
import { ModelFilterButtons } from "@/components/ModelFilterButtons";

type Row = {
  vendorId: string;
  month: string;
  model: string;
  vendorCode: string;
  vendorName: string;
  payable: number;
  adj: number;
  paid: number;
  balance: number;
  status: string;
  utr: string | null;
  remarks: string | null;
  paidOn: Date | null;
  ifsc: string | null;
  accountNo: string | null;
  bankName: string | null;
};

type Filters = { month: string; model: string; vendorId: string; q: string };

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-800",
  PARTIAL: "border-sky-300 bg-sky-50 text-sky-800",
  PAID: "border-green-300 bg-green-50 text-green-800",
};

export function PaymentsTable({
  rows,
  months,
  models,
  modelsWithData,
  vendors,
  totals,
  initial,
}: {
  rows: Row[];
  months: string[];
  models: { code: string; label: string; basis: string }[];
  modelsWithData: string[];
  vendors: { id: string; code: string | null; name: string }[];
  totals: { soldUncovered: number };
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [edit, setEdit] = useState<Row | null>(null);

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: f.q,
    matches: (r, n) =>
      r.vendorName.toLowerCase().includes(n) ||
      r.vendorCode.toLowerCase().includes(n) ||
      r.model.toLowerCase().includes(n) ||
      r.month.toLowerCase().includes(n) ||
      r.status.toLowerCase().includes(n),
    onOpen: (r) => setEdit(r),
  });

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["month", "model", "vendorId", "q"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onDownload = () => {
    const csv = toCsv(
      rows.map((r) => ({
        Month: r.month,
        "Vendor Code": r.vendorCode,
        "Vendor Name": r.vendorName,
        Model: r.model,
        Payable: r.payable.toFixed(2),
        "Adj (Dr/Cr)": r.adj.toFixed(2),
        Paid: r.paid.toFixed(2),
        Balance: r.balance.toFixed(2),
        Status: r.status,
        UTR: r.utr ?? "",
        "Paid On": toDisplayDate(r.paidOn),
        Remarks: r.remarks ?? "",
      })),
    );
    downloadCsv("payments.csv", csv);
  };

  const onBankCsv = () => {
    // Bank-payable rows = unpaid balance > 0 with bank details.
    const pay = rows
      .filter((r) => r.balance > 0.01 && r.ifsc && r.accountNo)
      .map((r) => ({
        "Beneficiary Name": r.vendorName,
        "Account Number": r.accountNo,
        IFSC: r.ifsc,
        Amount: r.balance.toFixed(2),
        Mode: "NEFT",
        Narration: `Adwitiya ${r.model} ${r.month}`,
      }));
    if (pay.length === 0) {
      toast.error("No payable rows with complete bank details");
      return;
    }
    downloadCsv(`bank-payable-${f.month || "all"}-${f.model || "all"}.csv`, toCsv(pay));
    toast.success(`${pay.length} row${pay.length === 1 ? "" : "s"} ready for bank upload`);
  };

  return (
    <>
      <div className="mb-4">
        <div className="card p-4 max-w-md">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Due Now · sold-uncovered</div>
          <div className={`font-display text-2xl font-bold tabular-nums ${totals.soldUncovered > 0.01 ? "text-amber-700" : "text-green-700"}`}>{totals.soldUncovered.toFixed(2)}</div>
          <div className="text-[11px] text-ink-faint">cash you should pay this cycle (sold − returns − payments)</div>
        </div>
      </div>

      <div className="mb-3 card p-3">
        <ModelFilterButtons allModels={models} modelsWithData={modelsWithData} current={initial.model} />
      </div>
      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input ref={searchRef} type="search" placeholder="Type to find a payable…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={searchKeyDown} className={`input pl-9 ${LIST_SEARCH_CLASS}`} />
        </div>
        <select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} className="input">
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <button type="submit" className="btn-primary">Apply</button>
        <div className="md:col-span-6 flex gap-2">
          <button type="button" onClick={onDownload} className="btn-secondary"><Download className="h-4 w-4" /> Download</button>
          <button type="button" onClick={onBankCsv} className="btn-yellow"><Banknote className="h-4 w-4" /> Bank Payable CSV</button>
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Month</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th text-right">Payable</th>
              <th className="th text-right">Adj</th>
              <th className="th text-right">Paid</th>
              <th className="th text-right">Balance</th>
              <th className="th">Status</th>
              <th className="th">UTR / Paid On</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <CreditCard className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No payables for the current filters.</div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr
                  key={`${r.vendorId}|${r.month}|${r.model}`}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
                >
                  <td className="td font-mono">{r.month}</td>
                  <td className="td">
                    <div>{r.vendorName}</div>
                    <div className="text-[10px] font-mono text-ink-faint">{r.vendorCode}</div>
                  </td>
                  <td className="td">{MODEL_LABELS[r.model as Model] ?? r.model}</td>
                  <td className="td text-right tabular-nums">{r.payable.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">
                    {Math.abs(r.adj) > 0.005 ? <span className={r.adj < 0 ? "text-amber-700" : "text-orange-700"}>{r.adj > 0 ? "+" : ""}{r.adj.toFixed(2)}</span> : "—"}
                  </td>
                  <td className="td text-right tabular-nums">{r.paid.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-bold">
                    <span className={r.balance > 0.01 ? "text-amber-700" : "text-green-700"}>{r.balance.toFixed(2)}</span>
                  </td>
                  <td className="td">
                    <span className={`badge ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>
                  </td>
                  <td className="td text-xs">
                    {r.utr ? <div className="font-mono">{r.utr}</div> : null}
                    {r.paidOn ? <div className="text-ink-faint">{toDisplayDate(r.paidOn)}</div> : null}
                    {!r.utr && !r.paidOn && <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => router.push(`/payments/breakup?vendorId=${r.vendorId}&month=${encodeURIComponent(r.month)}&model=${encodeURIComponent(r.model)}`)}
                        className="rounded p-1.5 hover:bg-brand-yellow-pale"
                        title="Transaction breakup"
                      >
                        <Receipt className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEdit(r)} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Update status">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {edit && <StatusModal row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />}
    </>
  );
}

function StatusModal({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("vendorId", row.vendorId);
    fd.set("month", row.month);
    fd.set("model", row.model);
    setErrors({});
    startTransition(async () => {
      const res = await upsertPaymentStatus(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Payment updated");
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-lg bg-white shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Update payment</div>
            <div className="font-display text-lg font-bold">{row.vendorName} · {row.month} · {row.model.replace("_", "-")}</div>
          </div>
          <button onClick={onClose} className="rounded p-1.5 hover:bg-brand-yellow-pale"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={onSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border bg-surface-gray-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Payable</div>
              <div className="tabular-nums font-medium">{row.payable.toFixed(2)}</div>
            </div>
            <div className="rounded border border-border bg-surface-gray-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Balance</div>
              <div className="tabular-nums font-medium">{row.balance.toFixed(2)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount paid</label>
              <input name="amountPaid" type="number" min="0" step="0.01" defaultValue={row.paid} className="input mt-1" />
              {errors.amountPaid && <div className="mt-1 text-[11px] text-red-700">{errors.amountPaid}</div>}
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={row.status} className="input mt-1">
                <option value="PENDING">Pending</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
            </div>
            <div>
              <label className="label">UTR / Ref</label>
              <input name="utr" defaultValue={row.utr ?? ""} className="input mt-1 font-mono" />
            </div>
            <div>
              <label className="label">Paid On</label>
              <input name="paidOn" type="date" defaultValue={row.paidOn ? toIsoDate(row.paidOn) : ""} className="input mt-1" />
            </div>
            <div className="col-span-2">
              <label className="label">Remarks</label>
              <textarea name="remarks" defaultValue={row.remarks ?? ""} className="input mt-1 min-h-[60px]" />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
