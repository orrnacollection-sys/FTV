"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useShortcut } from "@/hooks/useShortcut";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { Kbd } from "@/components/Kbd";
import { toast } from "@/components/Toast";
import { updateGRNHeader } from "../../actions";

type Warehouse = { id: string; code: string; name: string };

/**
 * Header-only edit for a POSTED GRN/RTV/RFV. Five editable fields, no line
 * items, no money math. Server enforces the same allow-list.
 */
export function GRNHeaderForm({
  grn,
  warehouses,
}: {
  grn: {
    id: string;
    grnNo: string;
    type: "PURCHASE" | "RTV" | "RFV";
    vendorName: string;
    vendorCode: string;
    grnDate: string;       // YYYY-MM-DD
    vendorInvoiceNo: string;
    vendorInvoiceDate: string; // YYYY-MM-DD or ""
    warehouseId: string;
    batchRemarks: string;
  };
  warehouses: Warehouse[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [grnDate, setGrnDate] = useState(grn.grnDate);
  const [invoiceNo, setInvoiceNo] = useState(grn.vendorInvoiceNo);
  const [invoiceDate, setInvoiceDate] = useState(grn.vendorInvoiceDate);
  const [warehouseId, setWarehouseId] = useState(grn.warehouseId);
  const [batchRemarks, setBatchRemarks] = useState(grn.batchRemarks);

  const backTo = `/grn/${grn.id}`;
  useUnsavedChanges(dirty, () => router.push(backTo));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!grnDate) { toast.error("GRN date required"); return; }
    if (!warehouseId) { toast.error("Warehouse required"); return; }
    startTransition(async () => {
      const res = await updateGRNHeader(grn.id, {
        grnDate, vendorInvoiceNo: invoiceNo || undefined,
        vendorInvoiceDate: invoiceDate || undefined,
        warehouseId, batchRemarks: batchRemarks || undefined,
      });
      if ("error" in res) { toast.error(res.error); return; }
      setDirty(false);
      toast.success(`Updated ${res.grnNo}`);
      router.push(backTo);
    });
  };

  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: "Save header", group: "Form",
  });

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={() => setDirty(true)} className="max-w-3xl space-y-6">
      <div className="card p-5 bg-amber-50 border-amber-200">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-amber-800 mb-2">Header-only edit</div>
        <p className="text-xs text-amber-900">
          Editing a <b>posted {grn.type === "PURCHASE" ? "GRN" : grn.type}</b> ({grn.grnNo}). Vendor, type, and line items are frozen. For SKU / qty / rate corrections,
          delete the document and recreate — the receivedQty bump rolls back automatically.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Vendor (frozen)</div>
          <div className="text-sm">{grn.vendorName} <span className="font-mono text-xs text-ink-faint">· {grn.vendorCode}</span></div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{grn.type === "PURCHASE" ? "GRN" : grn.type} Date <span className="text-red-600">*</span></label>
            <input type="date" required value={grnDate} onChange={(e) => setGrnDate(e.target.value)} className="input mt-1" />
          </div>
          <div>
            <label className="label">Warehouse <span className="text-red-600">*</span></label>
            <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input mt-1">
              <option value="">— select warehouse —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vendor Invoice No</label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="input mt-1" placeholder="e.g. INV-001" />
          </div>
          <div>
            <label className="label">Vendor Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input mt-1" />
          </div>
        </div>

        <div>
          <label className="label">Batch Remarks</label>
          <textarea
            value={batchRemarks}
            onChange={(e) => setBatchRemarks(e.target.value)}
            className="input mt-1 min-h-[80px]"
            placeholder="Quality notes for this batch…"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push(backTo)} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save header"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">Only the five fields above are touched. Stock + ledger unchanged.</span>
      </div>
    </form>
  );
}
