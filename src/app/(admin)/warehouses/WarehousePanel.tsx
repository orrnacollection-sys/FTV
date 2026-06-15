"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { createWarehouse, updateWarehouse, deleteWarehouse } from "./actions";
import {
  Plus,
  Pencil,
  Trash2,
  Warehouse as WarehouseIcon,
  X,
  Sparkles,
  Building2,
  AlertTriangle,
} from "lucide-react";
import { INDIAN_STATES, WAREHOUSE_TYPE_LABELS, COUNTRIES, DEFAULT_COUNTRY } from "@/lib/constants";

type LinkedPlace = {
  id: string;
  nickname: string;
  placeType: string;
  gstin: string;
  state: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
};

type Row = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  gst: string | null;
  type: string;
  vendorId: string | null;
  vendorLabel: string | null;
  placeId: string | null;
  place: LinkedPlace | null;
};

type VendorOption = { id: string; code: string | null; name: string };
type PlaceOption = LinkedPlace & { takenByWarehouseId: string | null };

export function WarehousePanel({
  rows,
  vendors,
  places,
}: {
  rows: Row[];
  vendors: VendorOption[];
  places: PlaceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Row | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form state — type drives vendor picker; state drives Place suggestions.
  const [createType, setCreateType] = useState<string>("OWN");
  const [editType, setEditType] = useState<string>("OWN");
  const [createState, setCreateState] = useState<string>("");
  const [editState, setEditState] = useState<string>("");
  // Selected place — keeps the hidden `placeId` form field in sync.
  const [createPlaceId, setCreatePlaceId] = useState<string>("");
  const [editPlaceId, setEditPlaceId] = useState<string>("");

  // Imperative refs to fill address fields when "Use this Place" is clicked.
  const createAddrRef = useRef<HTMLTextAreaElement>(null);
  const createCityRef = useRef<HTMLInputElement>(null);
  const createPinRef = useRef<HTMLInputElement>(null);
  const createGstRef = useRef<HTMLInputElement>(null);
  const editAddrRef = useRef<HTMLTextAreaElement>(null);
  const editCityRef = useRef<HTMLInputElement>(null);
  const editPinRef = useRef<HTMLInputElement>(null);
  const editGstRef = useRef<HTMLInputElement>(null);

  // O(1) lookup: state → available (unbound) places + the currently-bound
  // place for the row being edited.
  const placesByState = useMemo(() => {
    const m = new Map<string, PlaceOption[]>();
    for (const p of places) {
      if (!m.has(p.state)) m.set(p.state, []);
      m.get(p.state)!.push(p);
    }
    // Sort PPOB first within each state.
    for (const list of m.values()) {
      list.sort((a, b) => {
        if (a.placeType === b.placeType) return a.nickname.localeCompare(b.nickname);
        return a.placeType === "PPOB" ? -1 : 1;
      });
    }
    return m;
  }, [places]);

  const fillFromPlace = (
    place: PlaceOption | LinkedPlace,
    refs: {
      addr: React.RefObject<HTMLTextAreaElement | null>;
      city: React.RefObject<HTMLInputElement | null>;
      pin: React.RefObject<HTMLInputElement | null>;
      gst: React.RefObject<HTMLInputElement | null>;
    },
  ) => {
    if (refs.addr.current && place.address) refs.addr.current.value = place.address;
    if (refs.city.current && place.city) refs.city.current.value = place.city;
    if (refs.pin.current && place.pincode) refs.pin.current.value = place.pincode;
    if (refs.gst.current) refs.gst.current.value = place.gstin;
  };

  const onCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await createWarehouse(fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Warehouse created");
      (e.target as HTMLFormElement).reset();
      setCreateType("OWN");
      setCreateState("");
      setCreatePlaceId("");
      router.refresh();
    });
  };

  const onUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updateWarehouse(editing.id, fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Warehouse updated");
      setEditing(null);
      setEditPlaceId("");
      router.refresh();
    });
  };

  const onDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete warehouse "${name}"?`)) return;
    startTransition(async () => {
      const res = await deleteWarehouse(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  const startEdit = (w: Row) => {
    setEditing(w);
    setEditType(w.type);
    setEditState(w.state ?? "");
    setEditPlaceId(w.placeId ?? "");
    setErrors({});
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Warehouse ID</th>
              <th className="th">Name</th>
              <th className="th">Type</th>
              <th className="th">Vendor</th>
              <th className="th">Location</th>
              <th className="th">Declared on GST</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <WarehouseIcon className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No warehouses yet.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((w) => {
                const loc = [w.city, w.state, w.pincode].filter(Boolean).join(", ");
                const drift = w.place ? computeDrift(w) : null;
                return (
                  <tr key={w.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono text-xs">{w.code}</td>
                    <td className="td font-medium">{w.name}</td>
                    <td className="td">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        w.type === "THIRD_PARTY"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}>
                        {w.type === "THIRD_PARTY" ? "3P" : "Own"}
                      </span>
                    </td>
                    <td className="td text-ink-mid">{w.vendorLabel ?? "—"}</td>
                    <td className="td text-ink-mid">{loc || "—"}</td>
                    <td className="td">
                      <DeclaredCell row={w} drift={drift} />
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => startEdit(w)} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => onDelete(w.id, w.name)} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <form onSubmit={onUpdate} className="card p-5 h-fit space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[.1em]">Edit {editing.code}</div>
            <button type="button" onClick={() => setEditing(null)} className="rounded p-1 hover:bg-brand-yellow-pale"><X className="h-4 w-4" /></button>
          </div>

          <div>
            <label className="label">Name</label>
            <input name="name" defaultValue={editing.name} required className="input mt-1" />
            {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
          </div>

          <div>
            <label className="label">Ownership</label>
            <select
              name="type"
              value={editType}
              onChange={(e) => setEditType(e.target.value)}
              className="input mt-1"
            >
              {Object.entries(WAREHOUSE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {editType === "THIRD_PARTY" ? (
            <div>
              <label className="label">Vendor</label>
              <select name="vendorId" defaultValue={editing.vendorId ?? ""} className="input mt-1" required>
                <option value="">— Select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code ? `${v.code} · ${v.name}` : v.name}
                  </option>
                ))}
              </select>
              {errors.vendorId && <div className="mt-1 text-[11px] text-red-700">{errors.vendorId}</div>}
            </div>
          ) : (
            <input type="hidden" name="vendorId" value="" />
          )}

          <div>
            <label className="label">Street / Line 1</label>
            <textarea ref={editAddrRef} name="address" defaultValue={editing.address ?? ""} className="input mt-1 min-h-[60px]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">City</label>
              <input ref={editCityRef} name="city" defaultValue={editing.city ?? ""} className="input mt-1" />
              {errors.city && <div className="mt-1 text-[11px] text-red-700">{errors.city}</div>}
            </div>
            <div>
              <label className="label">Pincode</label>
              <input
                ref={editPinRef}
                name="pincode"
                defaultValue={editing.pincode ?? ""}
                inputMode="numeric"
                maxLength={6}
                pattern="[1-9][0-9]{5}"
                className="input mt-1 font-mono"
              />
              {errors.pincode && <div className="mt-1 text-[11px] text-red-700">{errors.pincode}</div>}
            </div>
          </div>

          <div>
            <label className="label">State</label>
            <select
              name="state"
              value={editState}
              onChange={(e) => { setEditState(e.target.value); setEditPlaceId(""); }}
              className="input mt-1"
            >
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.state && <div className="mt-1 text-[11px] text-red-700">{errors.state}</div>}
          </div>

          <div>
            <label className="label">Country</label>
            <select name="country" defaultValue={editing.country ?? DEFAULT_COUNTRY} className="input mt-1">
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {errors.country && <div className="mt-1 text-[11px] text-red-700">{errors.country}</div>}
          </div>

          {editType === "OWN" && (
            <PlacePicker
              state={editState}
              placesByState={placesByState}
              currentPlace={editing.place}
              currentWarehouseId={editing.id}
              selectedPlaceId={editPlaceId}
              onChange={(id) => setEditPlaceId(id)}
              onUse={(p) => fillFromPlace(p, { addr: editAddrRef, city: editCityRef, pin: editPinRef, gst: editGstRef })}
            />
          )}
          <input type="hidden" name="placeId" value={editType === "OWN" ? editPlaceId : ""} />

          <div>
            <label className="label">GSTIN</label>
            <input
              ref={editGstRef}
              name="gst"
              defaultValue={editing.gst ?? ""}
              placeholder="09AAAAA0000A1Z5"
              maxLength={15}
              autoCapitalize="characters"
              className="input mt-1 font-mono uppercase tracking-wide"
            />
            <p className="mt-1 text-[11px] text-ink-faint">Filled from the linked Place when one is picked. Editable for legacy / 3P cases.</p>
            {errors.gst && <div className="mt-1 text-[11px] text-red-700">{errors.gst}</div>}
          </div>

          <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Saving…" : "Save changes"}</button>
        </form>
      ) : (
        <form onSubmit={onCreate} className="card p-5 h-fit space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand-yellow-dark" />
            <div className="text-[10px] font-bold uppercase tracking-[.1em]">New warehouse</div>
          </div>

          <div>
            <label className="label">Name</label>
            <input name="name" required className="input mt-1" placeholder="e.g. Mumbai WH" />
            {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
          </div>

          <div>
            <label className="label">Ownership</label>
            <select
              name="type"
              value={createType}
              onChange={(e) => setCreateType(e.target.value)}
              className="input mt-1"
            >
              {Object.entries(WAREHOUSE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {createType === "THIRD_PARTY" ? (
            <div>
              <label className="label">Vendor</label>
              <select name="vendorId" className="input mt-1" required defaultValue="">
                <option value="">— Select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code ? `${v.code} · ${v.name}` : v.name}
                  </option>
                ))}
              </select>
              {errors.vendorId && <div className="mt-1 text-[11px] text-red-700">{errors.vendorId}</div>}
              <p className="mt-1 text-[11px] text-ink-faint">Third-party = vendor consignment location.</p>
            </div>
          ) : (
            <input type="hidden" name="vendorId" value="" />
          )}

          <div>
            <label className="label">Street / Line 1</label>
            <textarea ref={createAddrRef} name="address" className="input mt-1 min-h-[60px]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">City</label>
              <input ref={createCityRef} name="city" className="input mt-1" />
              {errors.city && <div className="mt-1 text-[11px] text-red-700">{errors.city}</div>}
            </div>
            <div>
              <label className="label">Pincode</label>
              <input
                ref={createPinRef}
                name="pincode"
                inputMode="numeric"
                maxLength={6}
                pattern="[1-9][0-9]{5}"
                className="input mt-1 font-mono"
                placeholder="400001"
              />
              {errors.pincode && <div className="mt-1 text-[11px] text-red-700">{errors.pincode}</div>}
            </div>
          </div>

          <div>
            <label className="label">State</label>
            <select
              name="state"
              className="input mt-1"
              value={createState}
              onChange={(e) => { setCreateState(e.target.value); setCreatePlaceId(""); }}
            >
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.state && <div className="mt-1 text-[11px] text-red-700">{errors.state}</div>}
          </div>

          <div>
            <label className="label">Country</label>
            <select name="country" className="input mt-1" defaultValue={DEFAULT_COUNTRY}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {errors.country && <div className="mt-1 text-[11px] text-red-700">{errors.country}</div>}
          </div>

          {createType === "OWN" && (
            <PlacePicker
              state={createState}
              placesByState={placesByState}
              currentPlace={null}
              currentWarehouseId={null}
              selectedPlaceId={createPlaceId}
              onChange={(id) => setCreatePlaceId(id)}
              onUse={(p) => fillFromPlace(p, { addr: createAddrRef, city: createCityRef, pin: createPinRef, gst: createGstRef })}
            />
          )}
          <input type="hidden" name="placeId" value={createType === "OWN" ? createPlaceId : ""} />

          <div>
            <label className="label">GSTIN</label>
            <input
              ref={createGstRef}
              name="gst"
              placeholder="09AAAAA0000A1Z5"
              maxLength={15}
              autoCapitalize="characters"
              className="input mt-1 font-mono uppercase tracking-wide"
            />
            {errors.gst && <div className="mt-1 text-[11px] text-red-700">{errors.gst}</div>}
          </div>

          <p className="text-[11px] text-ink-faint">ID auto-generates as WH-001, WH-002, …</p>
          <button type="submit" disabled={pending} className="btn-primary w-full">{pending ? "Creating…" : "Add warehouse"}</button>
        </form>
      )}
    </div>
  );
}

/** Per-row "declared on GST" cell. Three states:
 *   - linked + no drift → green pill with place nickname
 *   - linked + drift     → amber warning pill
 *   - not linked         → muted "—" */
function DeclaredCell({ row, drift }: { row: Row; drift: string | null }) {
  if (!row.place) {
    if (row.type === "THIRD_PARTY") {
      return <span className="text-ink-faint">vendor&apos;s GST</span>;
    }
    return <span className="text-ink-faint">not declared</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Building2 className="h-3 w-3 text-ink-faint" />
        <span className="text-xs">{row.place.nickname}</span>
        <span className="rounded-full bg-emerald-100 px-1.5 text-[9px] font-bold text-emerald-800">{row.place.placeType}</span>
      </div>
      <div className="font-mono text-[10px] text-ink-faint">{row.place.gstin}</div>
      {drift && (
        <div className="flex items-center gap-1 text-[10px] text-amber-700">
          <AlertTriangle className="h-3 w-3" /> address differs from declared
        </div>
      )}
    </div>
  );
}

function computeDrift(w: Row): string | null {
  if (!w.place) return null;
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const a = [norm(w.address), norm(w.city), norm(w.pincode)].join("|");
  const b = [norm(w.place.address), norm(w.place.city), norm(w.place.pincode)].join("|");
  return a === b ? null : "drift";
}

/** Per-state Place picker. Lists places registered in the warehouse's
 *  state, lets admin pick one, and (when picked) offers "Use this Place"
 *  to auto-fill address + city + pincode + GSTIN. */
function PlacePicker({
  state,
  placesByState,
  currentPlace,
  currentWarehouseId,
  selectedPlaceId,
  onChange,
  onUse,
}: {
  state: string;
  placesByState: Map<string, PlaceOption[]>;
  currentPlace: LinkedPlace | null;
  currentWarehouseId: string | null;
  selectedPlaceId: string;
  onChange: (placeId: string) => void;
  onUse: (place: PlaceOption | LinkedPlace) => void;
}) {
  if (!state) {
    return (
      <div className="rounded border border-dashed border-border bg-surface-gray-50 px-3 py-2">
        <p className="text-[11px] text-ink-faint">
          Pick a State above to see declared Places from your{" "}
          <Link href="/settings/company-profile" className="underline">Company Profile</Link>.
        </p>
      </div>
    );
  }
  const allInState = placesByState.get(state) ?? [];
  // A place is available if either nothing's bound to it, or it's bound
  // to the warehouse we're currently editing.
  const available = allInState.filter(
    (p) => !p.takenByWarehouseId || p.takenByWarehouseId === currentWarehouseId,
  );

  if (allInState.length === 0) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2">
        <p className="text-[11px] text-amber-800">
          No Places declared in {state} under any active GSTIN.{" "}
          <Link href="/settings/company-profile" className="font-bold underline">Register one</Link> to declare this warehouse on GST.
        </p>
      </div>
    );
  }

  // The "preferred" suggestion: the place currently selected, or PPOB,
  // or the first available.
  const preferredId = selectedPlaceId || currentPlace?.id || available[0]?.id || "";
  const preferred = available.find((p) => p.id === preferredId) ?? available[0];

  return (
    <div className="rounded border border-emerald-200 bg-emerald-50/60 px-3 py-2 space-y-2">
      <div>
        <label className="label inline-flex items-center gap-1 text-emerald-900">
          <Sparkles className="h-3 w-3" /> Declare on GST as
        </label>
        <select
          value={selectedPlaceId}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-1"
        >
          <option value="">— not declared —</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.placeType === "PPOB" ? "★ " : ""}
              {p.nickname} · {p.gstin}
            </option>
          ))}
        </select>
      </div>
      {preferred && (
        <button
          type="button"
          onClick={() => { onChange(preferred.id); onUse(preferred); }}
          className="w-full rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
        >
          Use {preferred.nickname} — fills address + GSTIN
        </button>
      )}
    </div>
  );
}
