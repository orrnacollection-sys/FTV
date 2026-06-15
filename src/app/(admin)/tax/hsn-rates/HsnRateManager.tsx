"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Pencil, Trash2, Plus, X, Search, AlertCircle } from "lucide-react";
import {
  TAX_SUPPLY_TYPES,
  TAX_SUPPLY_TYPE_LABELS,
  GST_SLABS,
} from "@/lib/constants";
import { createHsnRate, updateHsnRate, deleteHsnRate } from "../actions";

type Row = {
  id: string;
  hsn: string;
  description: string;
  slabRate: number;
  cessRate: number;
  supplyType: string;
  isReverseCharge: boolean;
  effectiveFrom: string; // YYYY-MM-DD
  notes: string | null;
  isActive: boolean;
};

const SUPPLY_TONE: Record<string, string> = {
  REGULAR: "bg-emerald-100 text-emerald-800",
  ZERO_RATED: "bg-blue-100 text-blue-800",
  NIL_RATED: "bg-amber-100 text-amber-800",
  EXEMPT: "bg-violet-100 text-violet-800",
  NON_GST: "bg-gray-100 text-gray-700",
};

export function HsnRateManager({
  rates,
  initialQuery,
  initialSupplyType,
  initialActive,
}: {
  rates: Row[];
  initialQuery: string;
  initialSupplyType: string;
  initialActive: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [q, setQ] = useState(initialQuery);
  const [supplyType, setSupplyType] = useState(initialSupplyType);
  const [active, setActive] = useState(initialActive);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (supplyType) url.searchParams.set("supplyType", supplyType); else url.searchParams.delete("supplyType");
    if (active) url.searchParams.set("active", active); else url.searchParams.delete("active");
    router.push(url.pathname + url.search);
  };

  const reset = () => { setEditing(null); setAdding(false); setErrors({}); };

  const onCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createHsnRate(fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("HSN rate added");
      reset();
      router.refresh();
    });
  };

  const onUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updateHsnRate(editing.id, fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("HSN rate updated");
      reset();
      router.refresh();
    });
  };

  const onDelete = (id: string, hsn: string) => {
    if (!window.confirm(`Delete HSN ${hsn}? Historical transactions will lose their rate lookup for this row.`)) return;
    startTransition(async () => {
      const res = await deleteHsnRate(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="HSN, description, notes…" value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9" />
        </div>
        <select value={supplyType} onChange={(e) => setSupplyType(e.target.value)} className="input max-w-[200px]">
          <option value="">All supply types</option>
          {TAX_SUPPLY_TYPES.map((t) => <option key={t} value={t}>{TAX_SUPPLY_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={active} onChange={(e) => setActive(e.target.value)} className="input max-w-[140px]">
          <option value="">All</option>
          <option value="yes">Active</option>
          <option value="no">Inactive</option>
        </select>
        <button type="submit" className="btn-secondary">Filter</button>
        <div className="ml-auto">
          {!editing && !adding && (
            <button type="button" onClick={() => { setAdding(true); setErrors({}); }} className="btn-primary">
              <Plus className="h-4 w-4" /> New rate
            </button>
          )}
        </div>
      </form>

      {/* Form (top-of-list) */}
      {(adding || editing) && (
        <form onSubmit={editing ? onUpdate : onCreate} className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[.1em]">
              {editing ? `Edit HSN ${editing.hsn}` : "Add HSN rate"}
            </div>
            <button type="button" onClick={reset} className="rounded p-1 hover:bg-brand-yellow-pale"><X className="h-4 w-4" /></button>
          </div>
          <RateFields initial={editing ?? undefined} errors={errors} />
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? "Saving…" : editing ? "Save changes" : "Add rate"}
          </button>
        </form>
      )}

      {/* Table */}
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">HSN/SAC</th>
              <th className="th">Description</th>
              <th className="th text-right">Slab %</th>
              <th className="th text-right">Cess %</th>
              <th className="th">Supply Type</th>
              <th className="th text-center">RCM</th>
              <th className="th">Effective from</th>
              <th className="th text-center">Active</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 ? (
              <tr>
                <td colSpan={9} className="td py-10 text-center text-ink-faint">
                  No HSN rates yet. Add a row above — &ldquo;6109 · 12%, regular, effective from 2017-07-01&rdquo; covers most apparel.
                </td>
              </tr>
            ) : (
              rates.map((r) => (
                <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-mono text-xs font-bold">{r.hsn}</td>
                  <td className="td">
                    <div className="font-medium">{r.description}</div>
                    {r.notes && <div className="text-[11px] text-ink-faint">{r.notes}</div>}
                  </td>
                  <td className="td text-right font-mono">{r.slabRate}%</td>
                  <td className="td text-right font-mono">{r.cessRate > 0 ? `${r.cessRate}%` : <span className="text-ink-faint">—</span>}</td>
                  <td className="td">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SUPPLY_TONE[r.supplyType] ?? "bg-gray-100"}`}>
                      {r.supplyType.replace("_", " ")}
                    </span>
                  </td>
                  <td className="td text-center">
                    {r.isReverseCharge ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800" title="Buyer pays GST">
                        <AlertCircle className="h-3 w-3" /> RCM
                      </span>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="td text-xs">{r.effectiveFrom}</td>
                  <td className="td text-center">
                    {r.isActive
                      ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">YES</span>
                      : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => { setEditing(r); setAdding(false); setErrors({}); }} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => onDelete(r.id, r.hsn)} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete">
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
  );
}

function RateFields({ initial, errors }: { initial?: Row; errors: Record<string, string> }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">HSN / SAC<span className="text-red-600">*</span></label>
          <input
            name="hsn"
            defaultValue={initial?.hsn ?? ""}
            placeholder="6109 or 998599"
            maxLength={8}
            inputMode="numeric"
            required
            className="input mt-1 font-mono"
          />
          {errors.hsn && <div className="mt-1 text-[11px] text-red-700">{errors.hsn}</div>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description<span className="text-red-600">*</span></label>
          <input
            name="description"
            defaultValue={initial?.description ?? ""}
            placeholder="T-shirts, knitted or crocheted"
            required
            className="input mt-1"
          />
          {errors.description && <div className="mt-1 text-[11px] text-red-700">{errors.description}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Slab Rate (%)<span className="text-red-600">*</span></label>
          <input
            name="slabRate"
            defaultValue={initial?.slabRate ?? ""}
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            list="gst-slabs"
            className="input mt-1 font-mono"
            placeholder="12"
          />
          <datalist id="gst-slabs">
            {GST_SLABS.map((s) => <option key={s} value={s} />)}
          </datalist>
          {errors.slabRate && <div className="mt-1 text-[11px] text-red-700">{errors.slabRate}</div>}
        </div>
        <div>
          <label className="label">Cess (%)</label>
          <input
            name="cessRate"
            defaultValue={initial?.cessRate ?? 0}
            type="number"
            min="0"
            step="0.01"
            className="input mt-1 font-mono"
            placeholder="0"
          />
          <p className="mt-1 text-[11px] text-ink-faint">On top of slab. 0 for most goods.</p>
        </div>
        <div>
          <label className="label">Effective From<span className="text-red-600">*</span></label>
          <input
            name="effectiveFrom"
            defaultValue={initial?.effectiveFrom ?? todayISO}
            type="date"
            required
            className="input mt-1"
          />
          {errors.effectiveFrom && <div className="mt-1 text-[11px] text-red-700">{errors.effectiveFrom}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Supply Type</label>
          <select name="supplyType" defaultValue={initial?.supplyType ?? "REGULAR"} className="input mt-1">
            {TAX_SUPPLY_TYPES.map((t) => <option key={t} value={t}>{TAX_SUPPLY_TYPE_LABELS[t]}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">
            Drives GSTR-1 row routing. Most goods = Regular.
          </p>
        </div>
        <div className="space-y-2 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isReverseCharge" defaultChecked={initial?.isReverseCharge ?? false} className="h-4 w-4" />
            Reverse charge (buyer pays GST)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="h-4 w-4" />
            Active
          </label>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <input
          name="notes"
          defaultValue={initial?.notes ?? ""}
          placeholder="GST council notification 1/2017, 28 Jun 2017"
          className="input mt-1"
        />
      </div>
    </>
  );
}
