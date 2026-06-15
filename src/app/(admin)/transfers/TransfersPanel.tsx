"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { createTransfer, deleteTransfer, bulkImportTransfers } from "./actions";
import { Plus, Trash2, ArrowRightLeft, Upload, Download, Search } from "lucide-react";
import { SkuPicker } from "@/components/SkuPicker";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";

type Row = {
  id: string;
  docNo: string | null;
  date: Date;
  skuCode: string;
  itemName: string;
  fromLabel: string;
  toLabel: string;
  /** True when the row carries from/to warehouse FKs (so it affects the
   *  Warehouse Stock pivot). Legacy rows without FKs are shown but ignored. */
  tracked: boolean;
  transferType: string | null;
  qty: number;
  notes: string | null;
};
type Item = { id: string; skuCode: string; name: string };
type Warehouse = { id: string; code: string; name: string };
type Filters = { q: string; transferType: string; from: string; to: string };

export function TransfersPanel({
  rows,
  items,
  warehouses,
  transferTypeOptions,
  initial,
}: {
  rows: Row[];
  items: Item[];
  warehouses: Warehouse[];
  transferTypeOptions: string[];
  initial: Filters;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState<Filters>(initial);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [pickedItemId, setPickedItemId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: "Add transfer", group: "Form",
  });

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "transferType", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createTransfer(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Transfer recorded");
      (e.target as HTMLFormElement).reset();
      setPickedItemId("");
      router.refresh();
    });
  };

  const onDelete = (id: string) => {
    if (!window.confirm("Delete this transfer row?")) return;
    startTransition(async () => {
      const res = await deleteTransfer(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await bulkImportTransfers(csvRows);
      const msg = `${res.created} imported` + (res.errors.length ? `, ${res.errors.length} errors` : "");
      setImportResult(res.errors.length ? `${msg} — ${res.errors.slice(0, 5).join(" | ")}` : null);
      if (res.errors.length === 0) toast.success(msg);
      else toast.error(msg);
      router.refresh();
    });
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        "Doc No": r.docNo ?? "",
        Date: toDisplayDate(r.date),
        SKU: r.skuCode,
        Item: r.itemName,
        From: r.fromLabel,
        To: r.toLabel,
        "Transfer Type": r.transferType ?? "",
        Qty: r.qty,
        Notes: r.notes ?? "",
      })),
      ["Doc No", "Date", "SKU", "Item", "From", "To", "Transfer Type", "Qty", "Notes"],
    );
    downloadCsv("transfers.csv", csv);
  };

  const downloadTemplate = () => {
    const sampleFrom = warehouses[0]?.code ?? "WH-001";
    const sampleTo = warehouses[1]?.code ?? "WH-002";
    const csv = toCsv(
      [{ Date: "01-04-2026", SKU: "SKU-001", From: sampleFrom, To: sampleTo, "Transfer Type": "SJIT", Qty: "10", Notes: "" }],
      ["Date", "SKU", "From", "To", "Transfer Type", "Qty", "Notes"],
    );
    downloadCsv("transfers-template.csv", csv);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <form onSubmit={onApply} className="mb-3 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-6">
          <div className="sm:col-span-2 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input type="search" placeholder="SKU or item" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
          </div>
          <select value={f.transferType} onChange={(e) => setF({ ...f, transferType: e.target.value })} className="input">
            <option value="">All types</option>
            {transferTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
          <div className="sm:col-span-6 flex flex-wrap gap-2 pt-1">
            <button type="submit" className="btn-primary">Apply filters</button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onImport(file); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
              <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
            </button>
            <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
            <button type="button" onClick={downloadTemplate} className="btn-secondary"><Download className="h-4 w-4" /> Template</button>
          </div>
        </form>

        {importResult ? (
          <div className="mb-3 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">{importResult}</div>
        ) : null}

        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Doc No</th>
                <th className="th">Date</th>
                <th className="th">SKU</th>
                <th className="th">Item</th>
                <th className="th">From</th>
                <th className="th">To</th>
                <th className="th">Type</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="td">
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                      <ArrowRightLeft className="h-10 w-10 opacity-40" />
                      <div className="text-sm">No transfers match.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono text-xs">{r.docNo ?? "—"}</td>
                    <td className="td">{toDisplayDate(r.date)}</td>
                    <td className="td font-mono text-xs">{r.skuCode}</td>
                    <td className="td">{r.itemName}</td>
                    <td className="td text-xs">{r.fromLabel}{!r.tracked && <span className="ml-1 text-[10px] text-amber-700" title="Legacy row — not reflected in Warehouse Stock pivot">⚠</span>}</td>
                    <td className="td text-xs">{r.toLabel}</td>
                    <td className="td">{r.transferType ?? "—"}</td>
                    <td className="td text-right tabular-nums">{r.qty.toFixed(2)}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <button type="button" onClick={() => onDelete(r.id)} className="rounded p-1.5 text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form ref={formRef} onSubmit={onAdd} className="card p-5 h-fit space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-brand-yellow-dark" />
          <div className="text-[10px] font-bold uppercase tracking-[.1em]">New transfer</div>
        </div>
        <div>
          <label className="label">Date <span className="text-red-600">*</span></label>
          <input name="date" type="date" required defaultValue={today} className="input mt-1" />
        </div>
        <div>
          <label className="label">Item <span className="text-red-600">*</span></label>
          <input type="hidden" name="itemId" value={pickedItemId} />
          <div className="mt-1">
            <SkuPicker
              items={items}
              value={pickedItemId}
              onChange={(id) => setPickedItemId(id)}
            />
          </div>
          {errors.itemId && <div className="mt-1 text-[11px] text-red-700">{errors.itemId}</div>}
        </div>
        <div>
          <label className="label">From warehouse <span className="text-red-600">*</span></label>
          <select name="fromWarehouseId" required className="input mt-1">
            <option value="">— select —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          {errors.fromWarehouseId && <div className="mt-1 text-[11px] text-red-700">{errors.fromWarehouseId}</div>}
        </div>
        <div>
          <label className="label">To warehouse <span className="text-red-600">*</span></label>
          <select name="toWarehouseId" required className="input mt-1">
            <option value="">— select —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          {errors.toWarehouseId && <div className="mt-1 text-[11px] text-red-700">{errors.toWarehouseId}</div>}
        </div>
        <div>
          <label className="label">Transfer type</label>
          <input name="transferType" list="transfer-type-options" className="input mt-1" placeholder="SJIT / SOR / Other — or type new" />
          <datalist id="transfer-type-options">
            {transferTypeOptions.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div>
          <label className="label">Quantity <span className="text-red-600">*</span></label>
          <input name="qty" type="number" min="0.01" step="0.01" required className="input mt-1" />
          {errors.qty && <div className="mt-1 text-[11px] text-red-700">{errors.qty}</div>}
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="input mt-1 min-h-[50px]" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving…" : "Add transfer"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
      </form>
    </div>
  );
}
