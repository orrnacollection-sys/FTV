"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { SkuPicker, type SkuPickerItem } from "@/components/SkuPicker";
import { INDIAN_STATES, isUnionTerritory, GST_REG_TYPE_LABELS, isB2BRegType } from "@/lib/constants";
import { X, Plus, Sparkles, AlertCircle, Warehouse as WarehouseIcon, UserRound } from "lucide-react";
import { createOrder, lookupOrderDefaults } from "./actions";

type WarehouseOption = { id: string; code: string; name: string; state: string | null };
type CustomerOption = { id: string; code: string | null; name: string; gstRegType: string; state: string | null };

/**
 * One-off Order entry modal. Mirrors the importer's projection but for a
 * single row. Submits via `createOrder` which runs in the same transaction
 * that creates the paired Sale row, so stock + ledger update immediately.
 *
 * Auto-fill chain when SKU + date settle:
 *   - Transfer Price ← ItemPriceRevision(itemId, ≤ date) most recent
 *   - GST Rate %     ← HsnRate(item.hsn, ≤ date) most recent, else
 *                       ItemPriceRevision.taxRate
 *
 * Admin can override either after auto-fill (the snapshot lives on the
 * Order; vendor payouts still go through the Vendor Ledger's own lookup
 * until Step 2 of the rollout).
 */
export function RecordSaleDialog({
  items,
  warehouses,
  customers,
  onClose,
  onCreated,
}: {
  items: SkuPickerItem[];
  warehouses: WarehouseOption[];
  customers: CustomerOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso);
  const [itemId, setItemId] = useState<string>("");
  const [marketplace, setMarketplace] = useState("Direct");
  const [channel, setChannel] = useState("DIRECT");
  const [type, setType] = useState("SALE");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [qty, setQty] = useState<string>("1");
  const [salePrice, setSalePrice] = useState<string>("");
  const [transferPrice, setTransferPrice] = useState<string>("");
  const [gstRate, setGstRate] = useState<string>("");
  const [taxableOverride, setTaxableOverride] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id ?? "");
  const [customerId, setCustomerId] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [lookupBadge, setLookupBadge] = useState<"resolved" | "unresolved" | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  // Auto-fill transferPrice + gstRate when SKU or date changes.
  const lookupKey = `${itemId}|${date}`;
  const prevLookup = useRef<string>("");
  useEffect(() => {
    if (!itemId || !date) return;
    if (prevLookup.current === lookupKey) return;
    prevLookup.current = lookupKey;
    setLookingUp(true);
    lookupOrderDefaults(itemId, date)
      .then((d) => {
        if (d.transferPrice !== null) setTransferPrice(d.transferPrice.toFixed(2));
        if (d.gstRate !== null) setGstRate(String(d.gstRate));
        setLookupBadge(d.unresolved ? "unresolved" : "resolved");
      })
      .catch(() => setLookupBadge("unresolved"))
      .finally(() => setLookingUp(false));
  }, [itemId, date, lookupKey]);

  // Live tax math (display only — server recomputes on submit).
  const qN = parseFloat(qty) || 0;
  const spN = parseFloat(salePrice) || 0;
  const tpN = parseFloat(transferPrice) || 0;
  const gstN = parseFloat(gstRate) || 0;
  const taxableComputed = parseFloat(taxableOverride) > 0 ? parseFloat(taxableOverride) : qN * spN;
  const gstAmount = (taxableComputed * gstN) / 100;
  // CGST+SGST vs IGST: intra-state when ship-FROM (warehouse) state matches
  // ship-TO (place of supply). Picking a warehouse drives accurate math now;
  // no more hardcoded "Uttar Pradesh" hack.
  const pickedWarehouse = warehouses.find((w) => w.id === warehouseId);
  const fromState = pickedWarehouse?.state?.trim() ?? "";
  const toState = placeOfSupply.trim();
  const intra = !!fromState && !!toState && fromState === toState;
  const utgst = intra && isUnionTerritory(toState);
  // Customer side — drives B2B / B2C label on the modal so admin sees the
  // classification before submitting.
  const pickedCustomer = customers.find((c) => c.id === customerId);
  const isB2B = isB2BRegType(pickedCustomer?.gstRegType);
  const cgst = intra ? gstAmount / 2 : 0;
  const sgst = intra && !utgst ? gstAmount / 2 : 0;
  const utgstAmt = utgst ? gstAmount / 2 : 0;
  const igst = intra ? 0 : gstAmount;
  const total = taxableComputed + cgst + sgst + utgstAmt + igst;
  const marginPerUnit = spN - tpN;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!itemId) { setError("Pick an SKU first."); return; }
    startTransition(async () => {
      const res = await createOrder({
        date,
        itemId,
        marketplace,
        channel,
        type,
        placeOfSupply: placeOfSupply || null,
        warehouseId: warehouseId || null,
        customerId: customerId || null,
        qty: qN,
        salePrice: spN,
        transferPrice: tpN,
        taxableValue: taxableComputed,
        gstRate: gstN,
        cgst,
        sgst: sgst + utgstAmt,  // UTGST goes into the sgst column for now
        igst,
        total,
        remarks: remarks || undefined,
      });
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success("Order recorded — paired Sale created");
      onCreated();
    });
  };

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8 overflow-y-auto">
      <form
        onSubmit={onSubmit}
        className="card relative w-full max-w-3xl bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 hover:bg-surface-gray-100"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-1 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
          Record Sale
        </div>
        <h2 className="mb-4 font-display text-2xl font-bold">New Order</h2>

        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        {/* What */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <label className="label">Date<span className="text-red-600">*</span></label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="input mt-1" />
          </div>
          <div className="sm:col-span-4">
            <label className="label">SKU<span className="text-red-600">*</span></label>
            <SkuPicker items={items} value={itemId} onChange={setItemId} autoFocus className="mt-1" />
            {lookupBadge === "resolved" && (
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <Sparkles className="h-3 w-3" /> Transfer + GST auto-filled from Item Price History
              </div>
            )}
            {lookupBadge === "unresolved" && (
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
                <AlertCircle className="h-3 w-3" /> No price history at this date — enter Transfer + GST manually
              </div>
            )}
            {lookingUp && <div className="mt-1 text-[11px] text-ink-faint">Looking up…</div>}
          </div>
        </div>

        {/* Channel */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="label">Channel</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input mt-1">
              <option value="DIRECT">Direct (counter / B2B)</option>
              <option value="WEBSITE">Website</option>
              <option value="MARKETPLACE">Marketplace</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Marketplace / Channel name</label>
            <input value={marketplace} onChange={(e) => setMarketplace(e.target.value)} placeholder="e.g. Amazon, Direct" className="input mt-1" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="input mt-1">
              <option value="SALE">Sale</option>
              <option value="RETURN">Return</option>
              <option value="RTO">RTO</option>
            </select>
          </div>
        </div>

        {/* Ship-from + ship-to party */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label inline-flex items-center gap-1">
              <WarehouseIcon className="h-3 w-3" /> Ship-from Warehouse
            </label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input mt-1">
              <option value="">— none (defaults inter-state) —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}{w.state ? ` (${w.state})` : ""}
                </option>
              ))}
            </select>
            {pickedWarehouse?.state && (
              <p className="mt-0.5 text-[10px] text-ink-faint">Ship-from state: <b>{pickedWarehouse.state}</b> — drives CGST/SGST vs IGST.</p>
            )}
          </div>
          <div>
            <label className="label inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" /> Customer (optional)
            </label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input mt-1">
              <option value="">— walk-in / unknown (B2C) —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ` : ""}{c.name} · {GST_REG_TYPE_LABELS[c.gstRegType as keyof typeof GST_REG_TYPE_LABELS] ?? c.gstRegType}
                </option>
              ))}
            </select>
            {pickedCustomer ? (
              <p className="mt-0.5 text-[10px] text-ink-faint">
                Classified as <b className={isB2B ? "text-blue-700" : "text-emerald-700"}>{isB2B ? "B2B" : "B2C"}</b>
                {pickedCustomer.state && (<> · billing state <b>{pickedCustomer.state}</b></>)}
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-ink-faint">Leave blank for marketplace / B2C orders.</p>
            )}
          </div>
        </div>

        {/* Qty + prices */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Qty<span className="text-red-600">*</span></label>
            <input type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} required className="input mt-1 text-right tabular-nums" />
          </div>
          <div>
            <label className="label" title="Customer-side: what the buyer paid per unit">Sale Price ₹<span className="text-red-600">*</span></label>
            <input type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required className="input mt-1 text-right tabular-nums" />
          </div>
          <div>
            <label className="label" title="Vendor-side: what we owe vendor per unit (snapshot)">Transfer Price ₹</label>
            <input type="number" min="0" step="0.01" value={transferPrice} onChange={(e) => setTransferPrice(e.target.value)} className="input mt-1 text-right tabular-nums" />
            <p className="mt-0.5 text-[10px] text-ink-faint">Display-only — vendor payouts still resolve from Item Price History.</p>
          </div>
          <div>
            <label className="label">Margin / unit</label>
            <div className={`input mt-1 text-right tabular-nums ${marginPerUnit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {marginPerUnit.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Tax */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">GST Rate %</label>
            <input type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="input mt-1 text-right tabular-nums" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Place of Supply (state)</label>
            <select value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} className="input mt-1">
              <option value="">— (defaults inter-state for tax math) —</option>
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Taxable (override)</label>
            <input type="number" min="0" step="0.01" value={taxableOverride} onChange={(e) => setTaxableOverride(e.target.value)} placeholder={(qN * spN).toFixed(2)} className="input mt-1 text-right tabular-nums" />
          </div>
        </div>

        {/* Live computed summary */}
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-[11px]">
            <div><div className="font-bold uppercase text-ink-faint">Taxable</div><div className="tabular-nums">₹{taxableComputed.toFixed(2)}</div></div>
            <div><div className="font-bold uppercase text-ink-faint">CGST</div><div className="tabular-nums">₹{cgst.toFixed(2)}</div></div>
            <div><div className="font-bold uppercase text-ink-faint">{utgst ? "UTGST" : "SGST"}</div><div className="tabular-nums">₹{(sgst + utgstAmt).toFixed(2)}</div></div>
            <div><div className="font-bold uppercase text-ink-faint">IGST</div><div className="tabular-nums">₹{igst.toFixed(2)}</div></div>
            <div><div className="font-bold uppercase text-ink-faint">Total</div><div className="font-bold tabular-nums">₹{total.toFixed(2)}</div></div>
          </div>
          <p className="mt-1 text-[10px] text-ink-faint">
            {pickedWarehouse?.state && placeOfSupply
              ? `Ship-from ${pickedWarehouse.state} → ship-to ${placeOfSupply}: ${intra ? "intra-state (CGST+SGST" + (utgst ? " / UTGST" : "") + ")" : "inter-state (IGST)"}.`
              : "Pick a warehouse + place of supply to drive accurate intra/inter-state tax."}
          </p>
        </div>

        {/* Remarks */}
        <div className="mt-3">
          <label className="label">Remarks</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Marketplace order ID, return reason, etc." className="input mt-1" />
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel (Esc)</button>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Saving…" : <><Plus className="h-4 w-4" /> Record Order</>}
          </button>
        </div>
      </form>
    </div>
  );
}
