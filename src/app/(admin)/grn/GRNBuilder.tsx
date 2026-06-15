"use client";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { toast } from "@/components/Toast";
import { Plus, Trash2, Upload, Download } from "lucide-react";
import { SkuPicker } from "@/components/SkuPicker";
import { createGRN, suggestPoForSku, suggestPoForSkus, updateGRNDraft } from "./actions";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { parseGrnItemsCsv } from "@/lib/grn-item-import";

type Vendor = { id: string; code: string | null; name: string };
type Warehouse = { id: string; code: string; name: string };
type Item = {
  id: string;
  skuCode: string;
  name: string;
  vendorId: string;
  latestRate: number;
  latestTax: number;
};

type Row = {
  itemId: string;
  poItemId?: string;
  poNumber?: string;
  poDate?: Date;
  pendingQty?: number;
  qty: number;
  rate: number;
  taxRate: number;
};

const emptyRow = (): Row => ({ itemId: "", qty: 1, rate: 0, taxRate: 0 });

/**
 * Initial state for edit mode. When unset, the builder is in create mode.
 * Only drafts are editable through this form (Stage B). Posted GRNs go
 * through a header-only form in Stage C.
 */
export type GRNBuilderInitial = {
  id: string;
  grnNo: string;
  isDraft: boolean;
  vendorId: string;
  warehouseId: string;
  grnDate: string;      // YYYY-MM-DD
  invoiceNo: string;
  invoiceDate: string;  // YYYY-MM-DD or ""
  items: Row[];
};

export function GRNBuilder({
  vendors,
  items,
  warehouses,
  initialType = "PURCHASE",
  returnTo = "/grn",
  initial,
}: {
  vendors: Vendor[];
  items: Item[];
  warehouses: Warehouse[];
  initialType?: "PURCHASE" | "RTV" | "RFV";
  returnTo?: string;
  initial?: GRNBuilderInitial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const today = new Date().toISOString().slice(0, 10);
  // Each entry point is fixed to its type (Purchase = /grn/new, RTV = /rtv, RFV = /rfv).
  const type = initialType;
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? "");
  const [grnDate, setGrnDate] = useState(initial?.grnDate ?? today);
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoiceNo ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? "");
  const [rows, setRows] = useState<Row[]>(initial?.items.length ? initial.items : [emptyRow()]);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  // Row index whose SkuPicker should auto-focus on next render. Set when the
  // user clicks "Add row" so the cursor lands in the new row's SKU box.
  const [focusRow, setFocusRow] = useState<number | null>(null);

  // When editing a draft, discard returns to the GRN view, not the list.
  const backTo = editing ? `/grn/${initial!.id}` : returnTo;
  useUnsavedChanges(dirty, () => router.push(backTo));

  // Pooled SKUs (Option B): any item can be received from any vendor, so the
  // picker is no longer filtered to the selected vendor's items.
  const itemsForVendor = items;

  const totals = useMemo(() => {
    let net = 0, tax = 0;
    for (const r of rows) {
      const lineNet = r.qty * r.rate;
      net += lineNet;
      tax += (lineNet * r.taxRate) / 100;
    }
    return { net, tax, grand: net + tax };
  }, [rows]);

  const update = (idx: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const onPickItem = async (idx: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    const next: Partial<Row> = {
      itemId,
      rate: it?.latestRate ?? 0,
      taxRate: it?.latestTax ?? 0,
      poItemId: undefined,
      poNumber: undefined,
      poDate: undefined,
      pendingQty: undefined,
    };
    update(idx, next);
    if (type === "PURCHASE" && vendorId && itemId) {
      const sugg = await suggestPoForSku(vendorId, itemId);
      if (sugg) {
        update(idx, {
          poItemId: sugg.poItemId,
          poNumber: sugg.poNumber,
          poDate: sugg.poDate,
          pendingQty: sugg.pendingQty,
        });
      }
    }
  };

  const submitGRN = (e: React.FormEvent, asDraft: boolean) => {
    e.preventDefault();
    if (!vendorId) { toast.error("Pick a vendor"); return; }
    if (!asDraft) {
      if (!warehouseId) { toast.error("Select a warehouse"); return; }
      if (!grnDate) { toast.error("GRN date required"); return; }
      if (rows.some((r) => !r.itemId)) { toast.error("Every row needs an item"); return; }
    }

    startTransition(async () => {
      const payload = {
        type,
        vendorId,
        warehouseId,
        grnDate,
        vendorInvoiceNo: invoiceNo || undefined,
        vendorInvoiceDate: invoiceDate || undefined,
        items: rows.filter((r) => r.itemId).map((r) => ({
          itemId: r.itemId,
          poItemId: r.poItemId,
          qty: Number(r.qty) || (asDraft ? 1 : 0),
          rejectedQty: 0,
          rate: Number(r.rate),
          taxRate: Number(r.taxRate),
        })),
      };
      const res = editing
        ? await updateGRNDraft(initial!.id, payload, asDraft)
        : await createGRN(payload, asDraft);
      if ("error" in res) { toast.error(res.error); return; }
      setDirty(false);
      const verb = editing ? "Updated" : "Created";
      toast.success(asDraft ? (editing ? "Draft saved" : "Saved as draft") : `${verb} ${res.grnNo}`);
      router.push(asDraft ? "/grn?view=drafts" : `/grn/${res.id}`);
    });
  };
  const onSubmit = (e: React.FormEvent) => submitGRN(e, false);
  const onSaveDraft = (e: React.FormEvent) => submitGRN(e, true);

  const formRef = useRef<HTMLFormElement>(null);
  const addRow = () => {
    setDirty(true);
    setRows((rs) => {
      const next = [...rs, emptyRow()];
      setFocusRow(next.length - 1);
      return next;
    });
  };
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: type === "PURCHASE" ? "Create GRN" : type === "RTV" ? "Create RTV" : "Create RFV",
    group: "Form",
  });
  useShortcut("mod+d", () => submitGRN({ preventDefault: () => {} } as unknown as React.FormEvent, true), {
    label: "Save as Draft", group: "Form",
  });
  useShortcut("alt+n", addRow, { label: "Add row", group: "Form" });

  // — Two-column SKU + Qty CSV import for the line-item table.
  // Header row is auto-detected: if the first row's second column is a number,
  // we assume there's no header. Duplicate SKUs are merged (qty summed). One
  // bad SKU blocks the whole batch — per user spec.
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const downloadImportTemplate = () => {
    const csv = toCsv([{ SKU: "SKU-001", Qty: "10" }, { SKU: "SKU-002", Qty: "5" }], ["SKU", "Qty"]);
    downloadCsv("grn-items-template.csv", csv);
  };

  const onImportItems = async (file: File) => {
    setImportErrors([]);
    if (!vendorId) { toast.error("Pick a vendor first"); return; }
    setImporting(true);
    try {
      const text = await file.text();
      const vendorName = vendors.find((v) => v.id === vendorId)?.name ?? "selected vendor";
      const parseResult = parseGrnItemsCsv(text, { vendorId, vendorName, items });
      if (!parseResult.ok) {
        setImportErrors(parseResult.errors);
        toast.error(`Import blocked — ${parseResult.errors.length} bad row${parseResult.errors.length === 1 ? "" : "s"}`);
        return;
      }
      if (parseResult.lines.length === 0) { toast.error("No valid items in file"); return; }

      // Confirm replace if user already has typed line items.
      const filledRows = rows.filter((r) => r.itemId).length;
      if (filledRows > 0 && !window.confirm(`Replace ${filledRows} existing line item${filledRows === 1 ? "" : "s"} with ${parseResult.lines.length} imported row${parseResult.lines.length === 1 ? "" : "s"}?`)) {
        return;
      }

      // Auto-link to oldest open PO line per SKU (PURCHASE only).
      let poMap: Record<string, { poItemId: string; poNumber: string; poDate: Date; pendingQty: number }> = {};
      if (type === "PURCHASE") {
        try {
          poMap = await suggestPoForSkus(vendorId, parseResult.lines.map((l) => l.itemId));
        } catch (e) {
          console.warn("[GRN import] PO link lookup failed; importing without links:", e);
        }
      }

      const itemById = new Map(items.map((it) => [it.id, it] as const));
      const newRows: Row[] = parseResult.lines.map(({ itemId, qty }) => {
        const it = itemById.get(itemId)!;
        const sugg = poMap[itemId];
        return {
          itemId,
          poItemId: sugg?.poItemId,
          poNumber: sugg?.poNumber,
          poDate: sugg?.poDate,
          pendingQty: sugg?.pendingQty,
          qty,
          rate: it.latestRate,
          taxRate: it.latestTax,
        };
      });
      setRows(newRows);
      setDirty(true);
      setFocusRow(null);
      const linked = Object.keys(poMap).length;
      toast.success(
        `${newRows.length} item${newRows.length === 1 ? "" : "s"} imported` +
        (type === "PURCHASE" && linked > 0 ? ` · ${linked} linked to open PO` : ""),
      );
    } catch (e) {
      console.error("[GRN import]", e);
      toast.error("Failed to import items");
    } finally {
      setImporting(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6">
      <section className="card p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="label">Type</label>
            <div className="input mt-1 flex items-center bg-surface-muted font-medium">
              {type === "PURCHASE" ? "Purchase" : type === "RTV" ? "Return to Vendor" : "Reject-In (Return From Vendor)"}
            </div>
          </div>
          <div>
            <label className="label">Vendor <span className="text-red-600">*</span></label>
            <select
              value={vendorId}
              onChange={(e) => {
                const filledRows = rows.filter((r) => r.itemId).length;
                if (filledRows > 0 && !window.confirm(`Changing vendor will discard ${filledRows} line item${filledRows === 1 ? "" : "s"}. Continue?`)) {
                  return;
                }
                setDirty(true);
                setVendorId(e.target.value);
                setRows([emptyRow()]);
              }}
              required
              className="input mt-1"
            >
              <option value="">— select —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Warehouse <span className="text-red-600">*</span></label>
            <select value={warehouseId} onChange={(e) => { setDirty(true); setWarehouseId(e.target.value); }} required className="input mt-1">
              <option value="">— select —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">GRN Date <span className="text-red-600">*</span></label>
            <input type="date" value={grnDate} onChange={(e) => { setDirty(true); setGrnDate(e.target.value); }} required className="input mt-1" />
          </div>
          <div>
            <label className="label">{type === "PURCHASE" ? "Invoice Date" : type === "RTV" ? "Debit Note Date" : "Credit Note Date"}</label>
            <input type="date" value={invoiceDate} onChange={(e) => { setDirty(true); setInvoiceDate(e.target.value); }} className="input mt-1" />
          </div>
          <div className="md:col-span-4">
            <label className="label">{type === "PURCHASE" ? "Vendor Invoice No." : type === "RTV" ? "Debit Note No." : "Credit Note No."}</label>
            <input value={invoiceNo} onChange={(e) => { setDirty(true); setInvoiceNo(e.target.value); }} className="input mt-1" />
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">
          Line items
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">SKU + Item</th>
                <th className="th w-24 text-right">Qty</th>
                <th className="th w-28 text-right">Unit Rate</th>
                <th className="th w-24 text-right">GST %</th>
                <th className="th w-28 text-right">Taxable</th>
                <th className="th w-24 text-right">GST</th>
                <th className="th w-28 text-right">Total</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const lineNet = r.qty * r.rate;
                const taxAmount = (lineNet * r.taxRate) / 100;
                return (
                  <Fragment key={idx}>
                    <tr>
                      <td className="td">
                        <SkuPicker
                          items={itemsForVendor.map((x) => ({ id: x.id, skuCode: x.skuCode, name: x.name }))}
                          value={r.itemId}
                          onChange={(id) => onPickItem(idx, id)}
                          autoFocus={idx === focusRow}
                        />
                      </td>
                      <td className="td">
                        <input type="number" min="0.01" step="0.01" value={r.qty} onChange={(e) => update(idx, { qty: parseFloat(e.target.value) || 0 })} className="input text-right tabular-nums" />
                      </td>
                      <td className="td">
                        <input type="number" min="0" step="0.01" value={r.rate} onChange={(e) => update(idx, { rate: parseFloat(e.target.value) || 0 })} className="input text-right tabular-nums" />
                      </td>
                      <td className="td">
                        <input type="number" min="0" max="100" step="0.01" value={r.taxRate} onChange={(e) => update(idx, { taxRate: parseFloat(e.target.value) || 0 })} className="input text-right tabular-nums" />
                      </td>
                      <td className="td text-right tabular-nums">{lineNet.toFixed(2)}</td>
                      <td className="td text-right tabular-nums">{taxAmount.toFixed(2)}</td>
                      <td className="td text-right tabular-nums font-medium">{(lineNet + taxAmount).toFixed(2)}</td>
                      <td className="td">
                        <button type="button" onClick={() => { setDirty(true); setRows((rs) => rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs); }} className="rounded p-1.5 text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                    {r.poNumber && type === "PURCHASE" && (
                      <tr className="bg-brand-yellow-50/30">
                        <td colSpan={8} className="px-3 py-1 text-[11px] text-ink-mid">
                          ↳ Linked to <b className="font-mono">{r.poNumber}</b> ({toDisplayDate(r.poDate ?? null)}) · Pending {r.pendingQty?.toFixed(2)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={addRow} className="btn-secondary">
              <Plus className="h-4 w-4" /> Add row <Kbd chord="alt+n" className="ml-1" />
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportItems(f); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              disabled={!vendorId || importing}
              title={!vendorId ? "Pick a vendor first" : undefined}
              className="btn-secondary"
            >
              <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import Items"}
            </button>
            <button type="button" onClick={downloadImportTemplate} className="btn-secondary">
              <Download className="h-4 w-4" /> Template
            </button>
          </div>
          <div className="text-sm space-y-1 text-right">
            <div>Net Taxable <span className="ml-6 tabular-nums">{totals.net.toFixed(2)}</span></div>
            <div>GST <span className="ml-6 tabular-nums">{totals.tax.toFixed(2)}</span></div>
            <div className="font-display text-lg font-bold border-t border-border pt-1">Grand Total <span className="ml-6 tabular-nums">{totals.grand.toFixed(2)}</span></div>
          </div>
        </div>
        {importErrors.length > 0 && (
          <div className="border-t border-red-200 bg-red-50 px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-red-800">
              Import blocked — {importErrors.length} bad row{importErrors.length === 1 ? "" : "s"}. Nothing was added.
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs text-red-700 space-y-0.5">
              {importErrors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {importErrors.length > 10 && <li className="italic">… and {importErrors.length - 10} more</li>}
            </ul>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push(backTo)} className="btn-secondary">Cancel</button>
        <button type="button" onClick={onSaveDraft} disabled={pending} className="btn-secondary">
          {pending ? "Saving…" : (editing ? "Update Draft" : "Save as Draft")} <Kbd chord="mod+d" className="ml-1" />
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : (editing ? `Promote to ${type === "PURCHASE" ? "GRN" : type}` : `Create ${type === "PURCHASE" ? "GRN" : type}`)}
          {" "}<Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">
          {editing
            ? "Promote allocates the real GRN number, moves stock and bumps the linked PO."
            : "Drafts don't move stock or post to the ledger until promoted."}
        </span>
      </div>
    </form>
  );
}
