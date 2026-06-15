"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { INDIAN_STATES } from "@/lib/constants";
import {
  Pencil,
  Trash2,
  Plus,
  X,
  Star,
  ChevronDown,
  ChevronRight,
  Building2,
  Warehouse as WarehouseIcon,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import {
  createGstin,
  updateGstin,
  deleteGstin,
  createPlace,
  updatePlace,
  deletePlace,
} from "./actions";

type LinkableWarehouse = {
  id: string;
  code: string;
  name: string;
  state: string | null;
};

type Place = {
  id: string;
  nickname: string;
  placeType: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  isActive: boolean;
  warehouse: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    city: string | null;
    pincode: string | null;
  } | null;
};

type Gstin = {
  id: string;
  gstin: string;
  state: string;
  registrationType: string;
  isActive: boolean;
  isDefault: boolean;
  places: Place[];
};

const REG_TYPES = [
  { val: "REGULAR", label: "Regular" },
  { val: "COMPOSITION", label: "Composition" },
  { val: "CASUAL", label: "Casual" },
  { val: "SEZ", label: "SEZ" },
];

const PLACE_TYPES = [
  { val: "PPOB", label: "Principal (PPOB)" },
  { val: "APOB", label: "Additional (APOB)" },
];

/** Compare a place's declared address against the linked warehouse's
 *  operational address. Returns a human-readable diff if they drift. */
function detectDrift(p: Place): string | null {
  if (!p.warehouse) return null;
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const placeAddr = [norm(p.address), norm(p.city), norm(p.pincode)].join("|");
  const whAddr = [norm(p.warehouse.address), norm(p.warehouse.city), norm(p.warehouse.pincode)].join("|");
  if (placeAddr === whAddr) return null;
  return "Address differs from the warehouse it's linked to.";
}

export function GstinManager({
  gstins,
  linkableWarehouses,
}: {
  gstins: Gstin[];
  linkableWarehouses: LinkableWarehouse[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(gstins.length === 1 ? [gstins[0].id] : []),
  );
  const [editingGstin, setEditingGstin] = useState<Gstin | null>(null);
  const [addingGstin, setAddingGstin] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Place sub-form state — open one at a time across the entire registry.
  const [placeForm, setPlaceForm] = useState<
    | { kind: "create"; gstinId: string }
    | { kind: "edit"; gstinId: string; place: Place }
    | null
  >(null);

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetGstinForm = () => { setEditingGstin(null); setAddingGstin(false); setErrors({}); };
  const resetPlaceForm = () => { setPlaceForm(null); setErrors({}); };

  const onCreateGstin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createGstin(fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("GSTIN added");
      resetGstinForm();
      router.refresh();
    });
  };

  const onUpdateGstin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingGstin) return;
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updateGstin(editingGstin.id, fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("GSTIN updated");
      resetGstinForm();
      router.refresh();
    });
  };

  const onDeleteGstin = (id: string, gstin: string) => {
    if (!window.confirm(`Delete GSTIN ${gstin}?\n\nAll its places must be removed first.`)) return;
    startTransition(async () => {
      const res = await deleteGstin(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  const onCreatePlace = (gstinId: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createPlace(gstinId, fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Place added");
      resetPlaceForm();
      router.refresh();
    });
  };

  const onUpdatePlace = (placeId: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updatePlace(placeId, fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Place updated");
      resetPlaceForm();
      router.refresh();
    });
  };

  const onDeletePlace = (id: string, nickname: string) => {
    if (!window.confirm(`Delete place "${nickname}"?`)) return;
    startTransition(async () => {
      const res = await deletePlace(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  return (
    <div className="space-y-4">
      {/* GSTIN list — each expandable to its Places */}
      <div className="space-y-3">
        {gstins.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-surface-gray-50 py-8 text-center text-sm text-ink-faint">
            No GSTINs registered yet. Add the first one below.
          </div>
        ) : (
          gstins.map((g) => {
            const open = expandedIds.has(g.id);
            return (
              <div key={g.id} className="rounded border border-border bg-white">
                {/* GSTIN header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-brand-yellow-pale/60 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 text-ink-faint" /> : <ChevronRight className="h-4 w-4 text-ink-faint" />}
                    <span className="font-mono text-sm font-bold">{g.gstin}</span>
                    <span className="text-xs text-ink-mid">·</span>
                    <span className="text-sm">{g.state}</span>
                    <span className="ml-1 text-[10px] font-bold uppercase text-ink-faint">{g.registrationType}</span>
                    {g.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        <Star className="h-3 w-3 fill-amber-400" /> default
                      </span>
                    )}
                    {!g.isActive && (
                      <span className="rounded-full bg-ink-faint/10 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-faint">
                        inactive
                      </span>
                    )}
                    <span className="ml-2 rounded bg-white px-2 py-0.5 text-[11px] text-ink-mid ring-1 ring-border">
                      {g.places.length} place{g.places.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => { setEditingGstin(g); setAddingGstin(false); setErrors({}); }}
                      className="rounded p-1.5 hover:bg-white"
                      title="Edit GSTIN"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteGstin(g.id, g.gstin)}
                      disabled={g.isDefault || g.places.length > 0}
                      className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        g.isDefault
                          ? "Pick another GSTIN as default first"
                          : g.places.length > 0
                          ? "Delete all places under this GSTIN first"
                          : "Delete GSTIN"
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded places */}
                {open && (
                  <div className="border-t border-border/60 bg-surface-gray-50 px-4 py-3">
                    <PlacesTable
                      places={g.places}
                      onAdd={() => { setPlaceForm({ kind: "create", gstinId: g.id }); setErrors({}); }}
                      onEdit={(p) => { setPlaceForm({ kind: "edit", gstinId: g.id, place: p }); setErrors({}); }}
                      onDelete={onDeletePlace}
                    />

                    {/* Inline Place form (open when targeting this gstin) */}
                    {placeForm?.gstinId === g.id && (
                      <div className="mt-3 rounded border border-border bg-white p-4">
                        {placeForm.kind === "create" ? (
                          <form onSubmit={(e) => onCreatePlace(g.id, e)} className="space-y-3">
                            <FormHeader title="Add place" onClose={resetPlaceForm} />
                            <PlaceFields
                              errors={errors}
                              linkableWarehouses={linkableWarehouses.filter(
                                (w) => !w.state || w.state === g.state,
                              )}
                            />
                            <button type="submit" disabled={pending} className="btn-primary w-full">
                              {pending ? "Adding…" : "Add place"}
                            </button>
                          </form>
                        ) : (
                          <form onSubmit={(e) => onUpdatePlace(placeForm.place.id, e)} className="space-y-3">
                            <FormHeader title={`Edit place: ${placeForm.place.nickname}`} onClose={resetPlaceForm} />
                            <PlaceFields
                              initial={placeForm.place}
                              errors={errors}
                              linkableWarehouses={linkableWarehouses.filter(
                                (w) => !w.state || w.state === g.state,
                              )}
                            />
                            <button type="submit" disabled={pending} className="btn-primary w-full">
                              {pending ? "Saving…" : "Save changes"}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Top-level GSTIN add/edit form */}
      {editingGstin ? (
        <form onSubmit={onUpdateGstin} className="card p-5 space-y-3">
          <FormHeader title={`Edit GSTIN: ${editingGstin.gstin}`} onClose={resetGstinForm} />
          <GstinFields initial={editingGstin} errors={errors} />
          <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Saving…" : "Save changes"}</button>
        </form>
      ) : addingGstin ? (
        <form onSubmit={onCreateGstin} className="card p-5 space-y-3">
          <FormHeader title="Register new GSTIN" onClose={resetGstinForm} />
          <GstinFields errors={errors} />
          <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Adding…" : "Register GSTIN"}</button>
        </form>
      ) : (
        <button type="button" onClick={() => { setAddingGstin(true); setErrors({}); }} className="btn-secondary">
          <Plus className="h-4 w-4" /> Register new GSTIN
        </button>
      )}
    </div>
  );
}

function FormHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[10px] font-bold uppercase tracking-[.1em]">{title}</div>
      <button type="button" onClick={onClose} className="rounded p-1 hover:bg-brand-yellow-pale">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function GstinFields({ initial, errors }: { initial?: Gstin; errors: Record<string, string> }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">GSTIN<span className="text-red-600">*</span></label>
          <input
            name="gstin"
            defaultValue={initial?.gstin ?? ""}
            placeholder="09AAAAA0000A1Z5"
            maxLength={15}
            required
            className="input mt-1 font-mono uppercase tracking-wide"
          />
          {errors.gstin && <div className="mt-1 text-[11px] text-red-700">{errors.gstin}</div>}
        </div>
        <div>
          <label className="label">State<span className="text-red-600">*</span></label>
          <select name="state" defaultValue={initial?.state ?? ""} required className="input mt-1">
            <option value="">— select —</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors.state && <div className="mt-1 text-[11px] text-red-700">{errors.state}</div>}
        </div>
        <div>
          <label className="label">Registration Type</label>
          <select name="registrationType" defaultValue={initial?.registrationType ?? "REGULAR"} className="input mt-1">
            {REG_TYPES.map((r) => <option key={r.val} value={r.val}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="h-4 w-4" />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isDefault" defaultChecked={initial?.isDefault ?? false} className="h-4 w-4" />
          Default (fallback for documents)
        </label>
      </div>
    </>
  );
}

function PlacesTable({
  places,
  onAdd,
  onEdit,
  onDelete,
}: {
  places: Place[];
  onAdd: () => void;
  onEdit: (p: Place) => void;
  onDelete: (id: string, nickname: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
          Places ({places.length})
        </div>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded border border-border bg-white px-2 py-1 text-xs font-medium hover:bg-brand-yellow-pale">
          <Plus className="h-3 w-3" /> Add place
        </button>
      </div>
      {places.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-white py-4 text-center text-xs text-ink-faint">
          No places declared yet. The PPOB is required for invoices.
        </div>
      ) : (
        <ul className="space-y-2">
          {places.map((p) => {
            const drift = detectDrift(p);
            const addrLine = [p.address, p.city, p.pincode].filter(Boolean).join(", ") || "— no address —";
            return (
              <li key={p.id} className="rounded border border-border bg-white px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-ink-faint" />
                      <span className="font-medium">{p.nickname}</span>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          p.placeType === "PPOB"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {p.placeType}
                      </span>
                      {!p.isActive && (
                        <span className="rounded-full bg-ink-faint/10 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-faint">inactive</span>
                      )}
                      {p.warehouse && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                          <WarehouseIcon className="h-3 w-3" /> {p.warehouse.code} · {p.warehouse.name}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ink-mid">{addrLine}</div>
                    {drift && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> {drift}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => onEdit(p)} className="rounded p-1 hover:bg-brand-yellow-pale" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => onDelete(p.id, p.nickname)} className="rounded p-1 text-red-700 hover:bg-red-50" title={p.placeType === "PPOB" ? "Promote another place to PPOB first" : "Delete"}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlaceFields({
  initial,
  errors,
  linkableWarehouses,
}: {
  initial?: Place;
  errors: Record<string, string>;
  linkableWarehouses: LinkableWarehouse[];
}) {
  const currentLinked = initial?.warehouse;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Nickname<span className="text-red-600">*</span></label>
          <input
            name="nickname"
            defaultValue={initial?.nickname ?? ""}
            placeholder="e.g. Surajpur HQ"
            required
            className="input mt-1"
          />
          {errors.nickname && <div className="mt-1 text-[11px] text-red-700">{errors.nickname}</div>}
        </div>
        <div>
          <label className="label">Place Type</label>
          <select name="placeType" defaultValue={initial?.placeType ?? "APOB"} className="input mt-1">
            {PLACE_TYPES.map((p) => <option key={p.val} value={p.val}>{p.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">Only one PPOB per GSTIN — switching demotes the old one.</p>
        </div>
      </div>

      <div>
        <label className="label">Street / Line 1</label>
        <textarea name="address" defaultValue={initial?.address ?? ""} className="input mt-1 min-h-[50px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">City</label>
          <input name="city" defaultValue={initial?.city ?? ""} className="input mt-1" />
          {errors.city && <div className="mt-1 text-[11px] text-red-700">{errors.city}</div>}
        </div>
        <div>
          <label className="label">Pincode</label>
          <input
            name="pincode"
            defaultValue={initial?.pincode ?? ""}
            inputMode="numeric"
            maxLength={6}
            pattern="[1-9][0-9]{5}"
            className="input mt-1 font-mono"
          />
          {errors.pincode && <div className="mt-1 text-[11px] text-red-700">{errors.pincode}</div>}
        </div>
      </div>

      <div>
        <label className="label inline-flex items-center gap-1">
          <LinkIcon className="h-3 w-3" /> Link to Warehouse (optional)
        </label>
        <select name="warehouseId" defaultValue={currentLinked?.id ?? ""} className="input mt-1">
          <option value="">— none (office / showroom) —</option>
          {currentLinked && (
            <option value={currentLinked.id}>
              {currentLinked.code} · {currentLinked.name} (currently linked)
            </option>
          )}
          {linkableWarehouses
            .filter((w) => w.id !== currentLinked?.id)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
        </select>
        <p className="mt-1 text-[11px] text-ink-faint">
          OWN warehouses in this GSTIN&apos;s state that aren&apos;t yet declared. Third-party warehouses can&apos;t link here.
        </p>
        {errors.warehouseId && <div className="mt-1 text-[11px] text-red-700">{errors.warehouseId}</div>}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="h-4 w-4" />
        Active
      </label>
    </>
  );
}
