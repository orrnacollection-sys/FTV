"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { Plus, Trash2, ImageIcon, AlertTriangle } from "lucide-react";
import { ImagePopup } from "../items/ImagePopup";
import { SkuPicker } from "@/components/SkuPicker";
import { createPO, updatePO } from "./actions";

type Vendor = { id: string; code: string | null; name: string };
type Item = {
  id: string;
  skuCode: string;
  name: string;
  hsn: string | null;
  vendorId: string;
  imageUrl: string | null;
  latestRate: number;
  latestTax: number;
};

type Row = {
  itemId: string;
  qty: number;
  rate: number;
  taxRate: number;
  /** Existing PurchaseOrderItem.id when editing — undefined for new rows. */
  poItemId?: string;
  /** Server-recorded receivedQty on this PO line — non-zero rows are locked. */
  receivedQty: number;
};

const emptyRow = (): Row => ({ itemId: "", qty: 1, rate: 0, taxRate: 0, receivedQty: 0 });

/**
 * Initial state for edit mode. When unset, the builder is in create mode.
 * `status` and `isDraft` drive what's locked on screen:
 *   • DRAFT: everything editable, "Update Draft" + "Promote to PO" buttons.
 *   • POSTED: vendor frozen; received line items frozen; "Update" button.
 */
export type POBuilderInitial = {
  id: string;
  poNumber: string;
  isDraft: boolean;
  status: string;
  vendorId: string;
  poDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD or empty
  notes: string;
  items: Row[];
};

export function POBuilder({
  vendors,
  items,
  initial,
}: {
  vendors: Vendor[];
  items: Item[];
  initial?: POBuilderInitial;
}) {
  const router = useRouter();
  const editing = !!initial;
  const isDraft = !!initial?.isDraft;
  const today = new Date().toISOString().slice(0, 10);
  const [vendorId, setVendorId] = useState<string>(initial?.vendorId ?? "");
  const [poDate, setPoDate] = useState<string>(initial?.poDate ?? today);
  const [dueDate, setDueDate] = useState<string>(initial?.dueDate ?? "");
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(initial?.items.length ? initial.items : [emptyRow()]);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  // Row index whose SkuPicker should auto-focus on next render. Set when the
  // user clicks "Add row" so the cursor lands in the new row's SKU box.
  const [focusRow, setFocusRow] = useState<number | null>(null);

  // In edit mode, discard returns to the PO view, not the list.
  const backTo = editing ? `/purchase-orders/${initial!.id}` : "/purchase-orders";
  useUnsavedChanges(dirty, () => router.push(backTo));

  // Pooled SKUs (Option B): any item can be ordered from any vendor, so the
  // picker is no longer filtered to the selected vendor's items.
  const itemsForVendor = items;

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const r of rows) {
      const net = r.qty * r.rate;
      subtotal += net;
      tax += (net * r.taxRate) / 100;
    }
    return { subtotal, tax, grand: subtotal + tax };
  }, [rows]);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const onSelectItem = (idx: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    updateRow(idx, {
      itemId,
      rate: it?.latestRate ?? 0,
      taxRate: it?.latestTax ?? 0,
    });
  };

  const addRow = () => {
    setDirty(true);
    setRows((rs) => {
      const next = [...rs, emptyRow()];
      setFocusRow(next.length - 1);
      return next;
    });
  };
  const removeRow = (idx: number) => {
    // On posted POs, received lines are locked — block the delete.
    const target = rows[idx];
    if (editing && !isDraft && target?.receivedQty && target.receivedQty > 0) {
      toast.error(`Line received ${target.receivedQty} — can't remove`);
      return;
    }
    setDirty(true);
    setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs));
  };

  const submitPO = (e: React.FormEvent, asDraft: boolean) => {
    e.preventDefault();
    if (!vendorId) { toast.error("Select a vendor"); return; }
    if (!asDraft) {
      // Drafts allow incomplete state; full saves get the strict checks.
      if (!poDate) { toast.error("PO date required"); return; }
      if (!dueDate) { toast.error("Due date is required"); return; }
      if (rows.length === 0 || rows.some((r) => !r.itemId)) { toast.error("Every row needs an item"); return; }
      const mismatched = rows.filter((r) => {
        const it = items.find((x) => x.id === r.itemId);
        return it && Math.abs(r.rate - it.latestRate) > 0.001;
      });
      if (mismatched.length > 0) {
        const ok = window.confirm(
          `${mismatched.length} line(s) have a rate different from the latest Item Master price. Generate the PO anyway?`,
        );
        if (!ok) return;
      }
    }

    startTransition(async () => {
      const payload = {
        vendorId,
        poDate,
        dueDate,
        notes: notes || undefined,
        items: rows.filter((r) => r.itemId).map((r) => ({
          poItemId: r.poItemId,
          itemId: r.itemId,
          qty: Number(r.qty) || (asDraft ? 1 : 0),
          rate: Number(r.rate),
          taxRate: Number(r.taxRate),
        })),
      };
      const res = editing
        ? await updatePO(initial!.id, payload, asDraft)
        : await createPO(payload, asDraft);
      if ("error" in res) { toast.error(res.error); return; }
      setDirty(false);
      const verb = editing ? "Updated" : "Created";
      toast.success(asDraft ? (editing ? "Draft saved" : "Saved as draft") : `${verb} ${res.poNumber}`);
      router.push(asDraft ? "/purchase-orders?view=drafts" : `/purchase-orders/${res.id}`);
    });
  };
  const onSubmit = (e: React.FormEvent) => submitPO(e, false);
  const onSaveDraft = (e: React.FormEvent) => submitPO(e, true);

  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: editing ? (isDraft ? "Promote to PO" : "Update PO") : "Create PO",
    group: "Form",
  });
  useShortcut("mod+d", () => submitPO({ preventDefault: () => {} } as unknown as React.FormEvent, true), {
    label: editing && !isDraft ? "Update PO" : "Save as Draft",
    group: "Form",
    // Only meaningful when there's a "save as draft" path — posted POs ignore it.
    enabled: !editing || isDraft,
  });
  useShortcut("alt+n", () => addRow(), {
    label: "Add row", group: "Form",
  });

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6">
      <section className="card p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label">Vendor <span className="text-red-600">*</span></label>
            <select
              value={vendorId}
              onChange={(e) => { setDirty(true); setVendorId(e.target.value); setRows([emptyRow()]); }}
              required
              disabled={editing && !isDraft}
              title={editing && !isDraft ? "Vendor is frozen on posted POs" : undefined}
              className="input mt-1 disabled:bg-surface-gray-100 disabled:text-ink-mid"
            >
              <option value="">— select vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
            </select>
            {editing && !isDraft && (
              <p className="mt-1 text-[11px] text-ink-faint">Vendor is frozen on posted POs. Delete + recreate if you need a different supplier.</p>
            )}
          </div>
          <div>
            <label className="label">PO Date <span className="text-red-600">*</span></label>
            <input type="date" value={poDate} onChange={(e) => { setDirty(true); setPoDate(e.target.value); }} required className="input mt-1" />
          </div>
          <div>
            <label className="label">Due Date<span className="text-red-600">*</span></label>
            <input type="date" required value={dueDate} onChange={(e) => { setDirty(true); setDueDate(e.target.value); }} className="input mt-1" />
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
                <th className="th w-12">Img</th>
                <th className="th">SKU + Item</th>
                <th className="th w-24">HSN</th>
                <th className="th w-24 text-right">Qty</th>
                <th className="th w-28 text-right">Rate</th>
                <th className="th w-24 text-right">GST %</th>
                <th className="th w-28 text-right">Total</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const it = items.find((x) => x.id === r.itemId);
                const lineNet = r.qty * r.rate;
                const lineTotal = lineNet + (lineNet * r.taxRate) / 100;
                // Warn if the entered rate differs from the item's latest master price.
                const priceMismatch = !!it && Math.abs(r.rate - it.latestRate) > 0.001;
                // Posted PO with this line already received → field-level lock.
                // SKU / rate / GST frozen; qty editable but can't go below received.
                const received = editing && !isDraft && (r.receivedQty ?? 0) > 0;
                return (
                  <tr key={idx} className={received ? "bg-surface-gray-100/40" : undefined}>
                    <td className="td">
                      {it?.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => setPreview({ src: it.imageUrl!, alt: it.name })}
                          className="block rounded border border-border overflow-hidden hover:ring-2 hover:ring-brand-yellow-dark"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={it.imageUrl} alt={it.name} className="h-10 w-10 object-cover" />
                        </button>
                      ) : (
                        <div className="h-10 w-10 rounded border border-dashed border-border bg-surface-gray-100 grid place-items-center">
                          <ImageIcon className="h-4 w-4 text-ink-faint" />
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <SkuPicker
                        items={itemsForVendor.map((x) => ({ id: x.id, skuCode: x.skuCode, name: x.name }))}
                        value={r.itemId}
                        onChange={(id) => onSelectItem(idx, id)}
                        autoFocus={idx === focusRow}
                        disabled={received}
                      />
                      {received && (
                        <div className="mt-1 text-[10px] text-ink-faint">
                          Received {r.receivedQty.toFixed(2)} — SKU, Rate & GST are locked
                        </div>
                      )}
                    </td>
                    <td className="td text-xs font-mono text-ink-mid">{it?.hsn ?? "—"}</td>
                    <td className="td">
                      <input
                        type="number"
                        min={received ? r.receivedQty : 0.01}
                        step="0.01"
                        value={r.qty}
                        onChange={(e) => updateRow(idx, { qty: parseFloat(e.target.value) || 0 })}
                        className="input text-right tabular-nums"
                        title={received ? `Minimum ${r.receivedQty.toFixed(2)} (already received)` : undefined}
                      />
                    </td>
                    <td className="td">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.rate}
                        onChange={(e) => updateRow(idx, { rate: parseFloat(e.target.value) || 0 })}
                        disabled={received}
                        className={cn(
                          "input text-right tabular-nums",
                          priceMismatch && "border-amber-400 bg-amber-50",
                          received && "disabled:bg-surface-gray-100 disabled:text-ink-mid",
                        )}
                        title={priceMismatch && it ? `Differs from Item Master price ${it.latestRate.toFixed(2)}` : undefined}
                      />
                      {priceMismatch && it && (
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-amber-700">
                          <AlertTriangle className="h-3 w-3" /> master {it.latestRate.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={r.taxRate}
                        onChange={(e) => updateRow(idx, { taxRate: parseFloat(e.target.value) || 0 })}
                        disabled={received}
                        className={cn(
                          "input text-right tabular-nums",
                          received && "disabled:bg-surface-gray-100 disabled:text-ink-mid",
                        )}
                      />
                    </td>
                    <td className="td text-right tabular-nums font-medium">{lineTotal.toFixed(2)}</td>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={received}
                        className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={received ? "Received lines can't be removed" : "Remove row"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border p-3">
          <button type="button" onClick={addRow} className="btn-secondary">
            <Plus className="h-4 w-4" /> Add row <Kbd chord="alt+n" className="ml-1" />
          </button>
          <div className="text-sm space-y-1 text-right">
            <div>Subtotal <span className="ml-6 tabular-nums">{totals.subtotal.toFixed(2)}</span></div>
            <div>GST <span className="ml-6 tabular-nums">{totals.tax.toFixed(2)}</span></div>
            <div className="font-display text-lg font-bold border-t border-border pt-1">Grand Total <span className="ml-6 tabular-nums">{totals.grand.toFixed(2)}</span></div>
          </div>
        </div>
      </section>

      <section>
        <label className="label">Notes</label>
        <textarea value={notes} onChange={(e) => { setDirty(true); setNotes(e.target.value); }} className="input mt-1 min-h-[60px]" />
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push(backTo)} className="btn-secondary">Cancel</button>
        {/* Save-as-draft only when there's a draft path: create mode, or editing a draft. */}
        {(!editing || isDraft) && (
          <button type="button" onClick={onSaveDraft} disabled={pending} className="btn-secondary">
            {pending ? "Saving…" : (editing ? "Update Draft" : "Save as Draft")} <Kbd chord="mod+d" className="ml-1" />
          </button>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : (editing ? (isDraft ? "Promote to PO" : "Update PO") : "Create PO")}
          {" "}<Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">
          {editing
            ? (isDraft ? "Promote allocates the real PO number." : "Posted PO: vendor is frozen, received lines locked.")
            : "Drafts skip the PO number — promote later when ready."}
        </span>
      </div>

      {preview && <ImagePopup src={preview.src} alt={preview.alt} onClose={() => setPreview(null)} />}
    </form>
  );
}
