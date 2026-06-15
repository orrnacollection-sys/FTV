"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { SkuPicker } from "@/components/SkuPicker";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { createSale } from "../actions";

type Item = { id: string; skuCode: string; name: string; vendor: string; latestRate: number; latestTax: number };
type Warehouse = { id: string; code: string; name: string };

export function RecordSaleForm({ items, warehouses }: { items: Item[]; warehouses: Warehouse[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [itemId, setItemId] = useState("");
  const [type, setType] = useState<"SALE" | "RETURN">("SALE");
  const [qtySold, setQtySold] = useState("1");
  const [qtyReturn, setQtyReturn] = useState("0");
  const [qtyRTO, setQtyRTO] = useState("0");

  const item = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  // Live estimate using the item's *latest* master price (server resolves by date authoritatively).
  const estimate = useMemo(() => {
    if (!item) return null;
    const net = (parseFloat(qtySold) || 0) - (parseFloat(qtyReturn) || 0);
    const amount = net * item.latestRate;
    const gst = (amount * item.latestTax) / 100;
    return { amount, gst, total: amount + gst };
  }, [item, qtySold, qtyReturn]);

  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: "Record sale", group: "Form",
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createSale(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Sale recorded");
      router.push("/sales");
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Voucher Date <span className="text-red-600">*</span></label>
          <input name="vchDate" type="date" required defaultValue={today} className="input mt-1" />
          {errors.vchDate && <div className="mt-1 text-[11px] text-red-700">{errors.vchDate}</div>}
        </div>
        <div>
          <label className="label">Marketplace <span className="text-red-600">*</span></label>
          <input name="marketplace" required className="input mt-1" placeholder="e.g. Myntra" />
          {errors.marketplace && <div className="mt-1 text-[11px] text-red-700">{errors.marketplace}</div>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Item (SKU) <span className="text-red-600">*</span></label>
          <input type="hidden" name="itemId" value={itemId} />
          <div className="mt-1">
            <SkuPicker
              items={items.map((i) => ({ id: i.id, skuCode: i.skuCode, name: i.name, vendor: i.vendor }))}
              value={itemId}
              onChange={(id) => setItemId(id)}
            />
          </div>
          {errors.itemId && <div className="mt-1 text-[11px] text-red-700">{errors.itemId}</div>}
        </div>
        <div>
          <label className="label">Warehouse <span className="text-red-600">*</span></label>
          <select name="warehouseId" required className="input mt-1">
            <option value="">— select —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select
            name="transactionType"
            value={type}
            onChange={(e) => {
              const t = e.target.value as "SALE" | "RETURN";
              setType(t);
              // Reset quantities so the hidden field(s) never carry stale values
              // into the submit (the server defaults absent fields to 0).
              if (t === "RETURN") { setQtySold("0"); setQtyRTO("0"); setQtyReturn("1"); }
              else { setQtyReturn("0"); setQtySold("1"); }
            }}
            className="input mt-1"
          >
            <option value="SALE">Sale</option>
            <option value="RETURN">Return</option>
          </select>
        </div>
        {type === "SALE" ? (
          <div className="grid grid-cols-2 gap-2 sm:col-span-1">
            <div>
              <label className="label">Qty Sold <span className="text-red-600">*</span></label>
              <input name="qtySold" type="number" min="0" step="1" value={qtySold} onChange={(e) => setQtySold(e.target.value)} className="input mt-1 text-right tabular-nums" />
            </div>
            <div>
              <label className="label">RTO</label>
              <input name="qtyRTO" type="number" min="0" step="1" value={qtyRTO} onChange={(e) => setQtyRTO(e.target.value)} className="input mt-1 text-right tabular-nums" />
            </div>
          </div>
        ) : (
          <div className="sm:col-span-1">
            <label className="label">Qty Returned <span className="text-red-600">*</span></label>
            <input name="qtyReturn" type="number" min="0" step="1" value={qtyReturn} onChange={(e) => setQtyReturn(e.target.value)} className="input mt-1 text-right tabular-nums" />
          </div>
        )}
        {errors.qtySold && <div className="sm:col-span-2 text-[11px] text-red-700">Enter a quantity greater than 0 for the selected type.</div>}
        <div className="sm:col-span-2">
          <label className="label">Remarks</label>
          <textarea name="manualRemarks" className="input mt-1 min-h-[60px]" />
        </div>
      </div>

      {item && estimate && (
        <div className="rounded border border-brand-yellow-light bg-brand-yellow-50 px-4 py-3 text-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mb-1">
            Estimate (at latest master price {item.latestRate.toFixed(2)} · {item.latestTax}% GST — server uses the rate effective on the voucher date)
          </div>
          <div className="flex gap-6 tabular-nums">
            <span>Amount <b>{estimate.amount.toFixed(2)}</b></span>
            <span>GST <b>{estimate.gst.toFixed(2)}</b></span>
            <span>Total <b>{estimate.total.toFixed(2)}</b></span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push("/sales")} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Record sale"} <Kbd chord="mod+enter" className="ml-1" /></button>
      </div>
    </form>
  );
}
