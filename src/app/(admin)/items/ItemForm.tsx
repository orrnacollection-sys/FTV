"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { toIsoDate } from "@/lib/date";
import { createItem, updateItem, quickCreateCategory } from "./actions";
import { ImagePopup } from "./ImagePopup";
import { toast } from "@/components/Toast";

type VendorOpt = { id: string; code: string | null; name: string; model: string | null };
type CategoryOpt = { id: string; name: string; path: string };
type ModelOpt = { code: string; label: string };

type InitialItem = {
  id: string;
  skuCode: string;
  name: string;
  hsn: string | null;
  categoryId: string | null;
  vendorId: string;
  vendorSku: string | null;
  imageUrl: string | null;
  itemType: string | null;
  model: string | null;
  transferPrice: number | null;
  taxRate: number | null;
  effectiveDate: Date | string | null;
};

export function ItemForm({
  vendors,
  categories: initialCategories,
  models,
  initial,
}: {
  vendors: VendorOpt[];
  categories: CategoryOpt[];
  models: ModelOpt[];
  initial?: InitialItem;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [categories, setCategories] = useState(initialCategories);
  // New items start blank (admin must pick); editing defaults to the SKU's current model.
  const [model, setModel] = useState<string>(initial?.model ?? "");
  const [itemType, setItemType] = useState<string>(initial?.itemType ?? "GOODS");
  const [imagePreview, setImagePreview] = useState<string | null>(initial?.imageUrl ?? null);
  const [showPopup, setShowPopup] = useState(false);

  useUnsavedChanges(dirty, () => router.push("/items"));

  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: editing ? "Update item" : "Create item",
    group: "Form",
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    setTopError(null);
    startTransition(async () => {
      const result = editing ? await updateItem(initial!.id, fd) : await createItem(fd);
      if (result && "ok" in result && result.ok === false) {
        setErrors(result.fieldErrors ?? {});
        setTopError(result.error);
      } else {
        setDirty(false);
      }
    });
  };

  const onQuickCategory = async () => {
    const name = window.prompt("New category name?");
    if (!name) return;
    const res = await quickCreateCategory(name);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Added "${res.name}"`);
    setCategories((c) => [...c, { id: res.id, name: res.name, path: res.name }].sort((a, b) => a.path.localeCompare(b.path)));
  };

  const onImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDirty(true);
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={() => setDirty(true)} className="space-y-6">
      {topError ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{topError}</div>
      ) : null}

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Identity</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Item Type <span className="text-red-600">*</span></label>
            <select name="itemType" value={itemType} onChange={(e) => { setItemType(e.target.value); setDirty(true); }} className="input mt-1 max-w-xs">
              <option value="GOODS">Goods — stock-tracked (GRN, inventory)</option>
              <option value="SERVICE">Service — billing only, no inventory</option>
            </select>
            {itemType === "SERVICE" && (
              <p className="mt-1 text-[11px] text-amber-700">
                Services aren&apos;t received via GRN and never appear in any stock / inventory report — they&apos;re used only on bills &amp; sales.
              </p>
            )}
          </div>
          <div>
            <label className="label">SKU Code <span className="text-red-600">*</span></label>
            <input name="skuCode" required defaultValue={initial?.skuCode ?? ""} className="input mt-1 font-mono" />
            {errors.skuCode && <div className="mt-1 text-[11px] text-red-700">{errors.skuCode}</div>}
          </div>
          <div>
            <label className="label">Name <span className="text-red-600">*</span></label>
            <input name="name" required defaultValue={initial?.name ?? ""} className="input mt-1" />
            {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
          </div>
          <div>
            <label className="label">HSN Code</label>
            <input name="hsn" defaultValue={initial?.hsn ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label">Vendor SKU</label>
            <input name="vendorSku" defaultValue={initial?.vendorSku ?? ""} className="input mt-1" />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Vendor & Model</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Vendor <span className="text-red-600">*</span></label>
            <select name="vendorId" required defaultValue={initial?.vendorId ?? ""} className="input mt-1">
              <option value="">— select vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code ? `${v.code} · ` : ""}{v.name}
                </option>
              ))}
            </select>
            {errors.vendorId && <div className="mt-1 text-[11px] text-red-700">{errors.vendorId}</div>}
          </div>
          <div>
            <label className="label">Model <span className="text-red-600">*</span></label>
            <select name="model" required value={model} onChange={(e) => setModel(e.target.value)} className="input mt-1">
              <option value="">— select model —</option>
              {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
            {errors.model && <div className="mt-1 text-[11px] text-red-700">{errors.model}</div>}
            <div className="mt-1 text-[11px] text-ink-faint">The model is effective-dated with this price. It can&apos;t be switched while stock is on hand.</div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Category</label>
            <div className="mt-1 flex gap-2">
              <select name="categoryId" defaultValue={initial?.categoryId ?? ""} className="input flex-1">
                <option value="">— uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.path}</option>
                ))}
              </select>
              <button type="button" onClick={onQuickCategory} className="btn-secondary whitespace-nowrap">
                + Quick add
              </button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Price (creates a revision)</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Transfer Price <span className="text-red-600">*</span></label>
            <input name="transferPrice" type="number" step="0.01" min="0" required defaultValue={initial?.transferPrice ?? ""} className="input mt-1" />
            {errors.transferPrice && <div className="mt-1 text-[11px] text-red-700">{errors.transferPrice}</div>}
          </div>
          <div>
            <label className="label">GST Rate (%) <span className="text-red-600">*</span></label>
            <input name="taxRate" type="number" step="0.01" min="0" max="100" required defaultValue={initial?.taxRate ?? ""} className="input mt-1" />
            {errors.taxRate && <div className="mt-1 text-[11px] text-red-700">{errors.taxRate}</div>}
          </div>
          <div>
            <label className="label">Effective Date <span className="text-red-600">*</span></label>
            <input name="effectiveDate" type="date" required defaultValue={initial?.effectiveDate ? toIsoDate(initial.effectiveDate) : new Date().toISOString().slice(0, 10)} className="input mt-1" />
            {errors.effectiveDate && <div className="mt-1 text-[11px] text-red-700">{errors.effectiveDate}</div>}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Image</div>
        <div className="flex items-start gap-4">
          {imagePreview ? (
            <button
              type="button"
              onClick={() => setShowPopup(true)}
              className="block rounded border border-border overflow-hidden hover:ring-2 hover:ring-brand-yellow-dark"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="preview" className="h-24 w-24 object-cover" />
            </button>
          ) : (
            <div className="h-24 w-24 rounded border border-dashed border-border bg-surface-gray-100" />
          )}
          <div className="flex-1">
            <label className="label">Upload image (PNG/JPG/WEBP, max 5 MB)</label>
            <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onImageChange} className="input mt-1" />
            {imagePreview && initial?.imageUrl && (
              <a href={initial.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-brand-yellow-dark hover:underline">
                Open current image in new tab ↗
              </a>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push("/items")} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : editing ? "Update item" : "Create item"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">Press Esc to discard changes.</span>
      </div>

      {showPopup && imagePreview && (
        <ImagePopup src={imagePreview} alt={initial?.name ?? "preview"} onClose={() => setShowPopup(false)} />
      )}
    </form>
  );
}
