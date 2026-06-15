"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { createModel, updateModel, deleteModel } from "./actions";
import { Layers, Plus, Pencil, Trash2, X } from "lucide-react";

type Row = {
  id: string;
  code: string;
  label: string;
  remarks: string | null;
  returnPolicy: string | null;
  isActive: boolean;
  sortOrder: number;
};

type Editing = { mode: "create" } | { mode: "edit"; row: Row } | null;

export function ModelPanel({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const close = () => {
    setEditing(null);
    setErrors({});
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const isCreate = editing.mode === "create";
    startTransition(async () => {
      const res = isCreate ? await createModel(fd) : await updateModel(fd);
      if ("error" in res && res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(isCreate ? "Model created" : "Model updated");
      close();
      router.refresh();
    });
  };

  const onDelete = (row: Row) => {
    if (!confirm(`Delete model "${row.code}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteModel(row.id);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${row.code} deleted`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setErrors({});
            setEditing({ mode: "create" });
          }}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Create model
        </button>
      </div>

      {editing && (
        <ModelForm
          editing={editing}
          pending={pending}
          errors={errors}
          onSubmit={onSubmit}
          onCancel={close}
          nextSort={rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0}
        />
      )}

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-ink-faint">
          <Layers className="h-10 w-10 mx-auto opacity-40 mb-2" />
          <div className="text-sm">No models yet. Click “Create model” to add one.</div>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Label</th>
                <th className="px-4 py-2.5 font-medium">Return policy</th>
                <th className="px-4 py-2.5 font-medium text-center">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <code className="rounded bg-brand-yellow-50 border border-brand-yellow-light px-2 py-0.5 text-xs font-mono font-bold">
                      {m.code}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.label}</div>
                    {m.remarks && <div className="text-xs text-ink-faint">{m.remarks}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-faint">{m.returnPolicy || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {m.isActive ? (
                      <span className="badge border-emerald-200 bg-emerald-50 text-emerald-700">active</span>
                    ) : (
                      <span className="badge border-gray-300 bg-gray-50 text-gray-600">inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setErrors({});
                          setEditing({ mode: "edit", row: m });
                        }}
                        className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(m)}
                        disabled={pending}
                        className="rounded-md p-1.5 text-ink-faint hover:bg-rose-50 hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ModelForm({
  editing,
  pending,
  errors,
  onSubmit,
  onCancel,
  nextSort,
}: {
  editing: Exclude<Editing, null>;
  pending: boolean;
  errors: Record<string, string>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  nextSort: number;
}) {
  const isCreate = editing.mode === "create";
  const row = editing.mode === "edit" ? editing.row : null;

  return (
    <form onSubmit={onSubmit} className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          {isCreate ? "Create model" : `Edit ${row?.code}`}
        </h2>
        <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {row && <input type="hidden" name="id" value={row.id} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {isCreate && (
          <div>
            <label className="label">Code</label>
            <input
              name="code"
              required
              autoFocus
              className="input mt-1 font-mono uppercase"
              placeholder="e.g. FTV"
            />
            {errors.code && <p className="mt-1 text-xs text-rose-600">{errors.code}</p>}
            <p className="mt-1 text-xs text-ink-faint">Letters, digits, underscore. Starts with a letter. Cannot be changed later.</p>
          </div>
        )}
        <div>
          <label className="label">Label</label>
          <input name="label" defaultValue={row?.label ?? ""} required className="input mt-1" placeholder="e.g. FTV" />
          {errors.label && <p className="mt-1 text-xs text-rose-600">{errors.label}</p>}
        </div>
        <div>
          <label className="label">Sort order</label>
          <input
            name="sortOrder"
            type="number"
            min="0"
            max="999"
            defaultValue={row?.sortOrder ?? nextSort}
            className="input mt-1"
          />
          {errors.sortOrder && <p className="mt-1 text-xs text-rose-600">{errors.sortOrder}</p>}
        </div>
        <div className="md:col-span-2">
          <label className="label">Return policy</label>
          <input
            name="returnPolicy"
            defaultValue={row?.returnPolicy ?? ""}
            className="input mt-1"
            placeholder="e.g. Returns accepted within 30 days"
          />
          {errors.returnPolicy && <p className="mt-1 text-xs text-rose-600">{errors.returnPolicy}</p>}
        </div>
        <div className="md:col-span-2">
          <label className="label">Remarks</label>
          <textarea name="remarks" defaultValue={row?.remarks ?? ""} className="input mt-1 min-h-[60px]" />
          {errors.remarks && <p className="mt-1 text-xs text-rose-600">{errors.remarks}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="isActive" defaultChecked={row?.isActive ?? true} className="accent-brand-yellow-dark" />
          Active
        </label>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : isCreate ? "Create" : "Save"}
        </button>
      </div>
    </form>
  );
}
