"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { updateSeries } from "./actions";

type Row = { id: string; docType: string; prefix: string; padding: number; nextNumber: number };

function preview(prefix: string, padding: number, nextNumber: number) {
  return `${prefix}${String(nextNumber).padStart(padding, "0")}`;
}

export function SeriesTable({ rows: initialRows }: { rows: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [pending, startTransition] = useTransition();

  const onSave = (row: Row) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("prefix", row.prefix);
    fd.set("padding", String(row.padding));
    fd.set("nextNumber", String(row.nextNumber));
    startTransition(async () => {
      const res = await updateSeries(fd);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`${row.docType} series updated`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-display text-lg font-bold">{r.docType}</div>
            <code className="rounded bg-brand-yellow-50 border border-brand-yellow-light px-2 py-0.5 text-xs font-mono">
              Next: {preview(r.prefix, r.padding, r.nextNumber)}
            </code>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="label">Prefix</label>
              <input value={r.prefix} onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, prefix: e.target.value } : x))} className="input mt-1" />
            </div>
            <div>
              <label className="label">Padding</label>
              <input type="number" min="1" max="10" value={r.padding} onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, padding: parseInt(e.target.value) || 0 } : x))} className="input mt-1" />
            </div>
            <div>
              <label className="label">Next number</label>
              <input type="number" min="1" value={r.nextNumber} onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, nextNumber: parseInt(e.target.value) || 0 } : x))} className="input mt-1" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => onSave(r)} disabled={pending} className="btn-primary w-full">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
