"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { saveLedgerCoding } from "./actions";

const MODES = [
  { value: "AUTO", label: "Auto (series)", desc: "System assigns the next code from a configurable series." },
  { value: "MANUAL", label: "Manual", desc: "You type a unique code on each ledger." },
  { value: "NONE", label: "No code", desc: "Name-only ledgers (Tally-style)." },
];

export function LedgerCodingForm({
  mode: initialMode,
  series,
}: {
  mode: string;
  series: { prefix: string; padding: number; nextNumber: number };
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [prefix, setPrefix] = useState(series.prefix);
  const [padding, setPadding] = useState(series.padding);
  const [nextNumber, setNextNumber] = useState(series.nextNumber);
  const [pending, start] = useTransition();

  const onSave = () => {
    start(async () => {
      const r = await saveLedgerCoding({ mode, prefix, padding, nextNumber });
      if (r?.ok) {
        toast.success("Ledger coding saved");
        router.refresh();
      } else {
        toast.error(r?.error ?? "Save failed");
      }
    });
  };

  const preview = `${prefix}${String(nextNumber).padStart(Math.max(1, padding), "0")}`;

  return (
    <div className="space-y-6">
      <div className="card space-y-2 p-4">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition ${
              mode === m.value ? "border-brand-yellow-dark bg-brand-yellow-pale" : "border-border hover:bg-surface-gray-100"
            }`}
          >
            <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1" />
            <div>
              <div className="text-sm font-bold">{m.label}</div>
              <div className="text-xs text-ink-faint">{m.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === "AUTO" && (
        <div className="card p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Series configuration</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Prefix</label>
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="input mt-1 font-mono" />
            </div>
            <div>
              <label className="label">Padding</label>
              <input type="number" min={1} max={8} value={padding} onChange={(e) => setPadding(Number(e.target.value) || 1)} className="input mt-1" />
            </div>
            <div>
              <label className="label">Next number</label>
              <input type="number" min={1} value={nextNumber} onChange={(e) => setNextNumber(Number(e.target.value) || 1)} className="input mt-1" />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-mid">
            Next ledger code preview: <span className="font-mono font-bold text-ink">{preview}</span>
          </p>
        </div>
      )}

      <button onClick={onSave} disabled={pending} className="btn-primary">
        {pending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
