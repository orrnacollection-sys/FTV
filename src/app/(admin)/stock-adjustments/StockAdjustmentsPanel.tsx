"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { createStockAdjustment, deleteStockAdjustment, bulkImportAdjustments } from "./actions";
import { Plus, Trash2, SlidersHorizontal, Upload, Download, Search } from "lucide-react";
import { SkuPicker } from "@/components/SkuPicker";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";

type Row = {
  id: string;
  adjNo: string | null;
  date: Date;
  skuCode: string;
  itemName: string;
  warehouse: string | null;
  qtyChange: number;
  reason: string;
  notes: string | null;
};
type Item = { id: string; skuCode: string; name: string };
type Warehouse = { id: string; code: string; name: string };
type Filters = { q: string; warehouseId: string; from: string; to: string };

export function StockAdjustmentsPanel({
  rows,
  items,
  warehouses,
  initial,
}: {
  rows: Row[];
  items: Item[];
  warehouses: Warehouse[];
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
    label: "Add adjustment", group: "Form",
  });

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "warehouseId", "from", "to"] as const).forEach((k) => {
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
      const res = await createStockAdjustment(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(`Adjustment ${res.adjNo} recorded`);
      (e.target as HTMLFormElement).reset();
      setPickedItemId("");
      router.refresh();
    });
  };

  const onDelete = (id: string, adjNo: string | null) => {
    if (!window.confirm(`Delete adjustment ${adjNo ?? ""}?`)) return;
    startTransition(async () => {
      const res = await deleteStockAdjustment(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await bulkImportAdjustments(csvRows);
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
        "Adj No": r.adjNo ?? "",
        Date: toDisplayDate(r.date),
        SKU: r.skuCode,
        Item: r.itemName,
        Warehouse: r.warehouse ?? "",
        "Qty Change": r.qtyChange,
        Reason: r.reason,
        Notes: r.notes ?? "",
      })),
      ["Adj No", "Date", "SKU", "Item", "Warehouse", "Qty Change", "Reason", "Notes"],
    );
    downloadCsv("stock-adjustments.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{ Date: "01-04-2026", SKU: "SKU-001", Warehouse: "", Direction: "ADD", Qty: "5", Reason: "Cycle count", Notes: "" }],
      ["Date", "SKU", "Warehouse", "Direction", "Qty", "Reason", "Notes"],
    );
    downloadCsv("stock-adjustments-template.csv", csv);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <form onSubmit={onApply} className="mb-3 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
          <div className="sm:col-span-2 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input type="search" placeholder="SKU or item" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
          </div>
          <select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} className="input">
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
          <div className="sm:col-span-5 flex flex-wrap gap-2 pt-1">
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
                <th className="th">Adj No</th>
                <th className="th">Date</th>
                <th className="th">SKU</th>
                <th className="th">Item</th>
                <th className="th">Warehouse</th>
                <th className="th text-right">Qty Change</th>
                <th className="th">Reason</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="td">
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                      <SlidersHorizontal className="h-10 w-10 opacity-40" />
                      <div className="text-sm">No adjustments match.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono text-xs">{r.adjNo ?? "—"}</td>
                    <td className="td">{toDisplayDate(r.date)}</td>
                    <td className="td font-mono text-xs">{r.skuCode}</td>
                    <td className="td">{r.itemName}</td>
                    <td className="td">{r.warehouse ?? "—"}</td>
                    <td className="td text-right tabular-nums font-medium">
                      <span className={r.qtyChange < 0 ? "text-red-700" : "text-emerald-700"}>
                        {r.qtyChange > 0 ? "+" : ""}{r.qtyChange.toFixed(2)}
                      </span>
                    </td>
                    <td className="td">
                      {r.reason}
                      {r.notes && <div className="text-[11px] text-ink-faint">{r.notes}</div>}
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <button type="button" onClick={() => onDelete(r.id, r.adjNo)} className="rounded p-1.5 text-red-700 hover:bg-red-50">
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
          <div className="text-[10px] font-bold uppercase tracking-[.1em]">New adjustment</div>
        </div>
        <div>
          <label className="label">Date</label>
          <input name="date" type="date" required defaultValue={today} className="input mt-1" />
          {errors.date && <div className="mt-1 text-[11px] text-red-700">{errors.date}</div>}
        </div>
        <div>
          <label className="label">Item</label>
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
          <label className="label">Warehouse (optional)</label>
          <select name="warehouseId" className="input mt-1">
            <option value="">— none —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Direction</label>
          <select name="direction" required className="input mt-1">
            <option value="ADD">Add (+)</option>
            <option value="REMOVE">Remove (−)</option>
          </select>
        </div>
        <div>
          <label className="label">Quantity</label>
          <input name="qty" type="number" min="0.01" step="0.01" required className="input mt-1" />
          {errors.qty && <div className="mt-1 text-[11px] text-red-700">{errors.qty}</div>}
        </div>
        <div>
          <label className="label">Reason</label>
          <input name="reason" required className="input mt-1" placeholder="e.g. Cycle count, damage…" />
          {errors.reason && <div className="mt-1 text-[11px] text-red-700">{errors.reason}</div>}
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea name="notes" className="input mt-1 min-h-[50px]" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Saving…" : "Add adjustment"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
      </form>
    </div>
  );
}
