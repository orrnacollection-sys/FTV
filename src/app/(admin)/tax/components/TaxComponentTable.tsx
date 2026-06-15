"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Pencil, X, Check } from "lucide-react";
import { updateTaxComponent } from "../actions";

type Row = {
  id: string;
  code: string;
  name: string;
  family: string;
  chargeType: string;
  scope: string;
  slabFraction: number;
  isActive: boolean;
  sortOrder: number;
};

const FAMILY_COLOR: Record<string, string> = {
  GST: "bg-emerald-100 text-emerald-800",
  CESS: "bg-amber-100 text-amber-800",
  TDS: "bg-violet-100 text-violet-800",
  TCS: "bg-blue-100 text-blue-800",
};

const SCOPE_LABEL: Record<string, string> = {
  INTRA_STATE: "Intra-state",
  INTER_STATE: "Inter-state",
  INTRA_UT: "Intra-UT",
  ANY: "Any",
};

export function TaxComponentTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const onSubmit = (id: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateTaxComponent(id, fd);
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("Saved");
      setEditingId(null);
      router.refresh();
    });
  };

  return (
    <div className="table-wrap">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Code</th>
            <th className="th">Name</th>
            <th className="th">Family</th>
            <th className="th">Charge</th>
            <th className="th">Scope</th>
            <th className="th text-right">Slab %</th>
            <th className="th text-center">Active</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                <td className="td font-mono text-xs font-bold">{r.code}</td>
                <td className="td">
                  {isEditing ? (
                    <input name="name" defaultValue={r.name} required className="input py-1 text-sm" form={`form-${r.id}`} />
                  ) : (
                    r.name
                  )}
                </td>
                <td className="td">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${FAMILY_COLOR[r.family] ?? "bg-gray-100 text-gray-700"}`}>
                    {r.family}
                  </span>
                </td>
                <td className="td">
                  <span className={`text-xs ${r.chargeType === "REVERSE" ? "text-violet-700 font-medium" : "text-ink-mid"}`}>
                    {r.chargeType === "REVERSE" ? "Reverse" : "Forward"}
                  </span>
                </td>
                <td className="td text-xs text-ink-mid">{SCOPE_LABEL[r.scope] ?? r.scope}</td>
                <td className="td text-right font-mono text-xs">
                  {r.slabFraction === 1 ? "100%" : r.slabFraction === 0.5 ? "50%" : r.slabFraction === 0 ? <span className="text-ink-faint">—</span> : `${(r.slabFraction * 100).toFixed(0)}%`}
                </td>
                <td className="td text-center">
                  {isEditing ? (
                    <input type="checkbox" name="isActive" defaultChecked={r.isActive} form={`form-${r.id}`} className="h-4 w-4" />
                  ) : r.isActive ? (
                    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">YES</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="td">
                  {isEditing ? (
                    <form id={`form-${r.id}`} onSubmit={(e) => onSubmit(r.id, e)} className="flex justify-end gap-1">
                      <input type="hidden" name="sortOrder" value={r.sortOrder} />
                      <button type="submit" disabled={pending} className="rounded p-1 text-emerald-700 hover:bg-emerald-50" title="Save">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded p-1 text-ink-faint hover:bg-surface-gray-100" title="Cancel">
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setEditingId(r.id)} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
