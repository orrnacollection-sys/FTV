"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { DateField } from "@/components/DateField";
import { fyPresets, isoUtc } from "@/lib/fy";
import { setPeriod } from "@/components/period-actions";

/** Topbar period selector — Tally's Alt+F2. Shows the active financial year /
 *  range; the popup offers FY presets and a custom From/To range. */
export function PeriodControl({
  label,
  fromIso,
  toIso,
  fyStartMonth,
}: {
  label: string;
  fromIso: string;
  toIso: string;
  fyStartMonth: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(fromIso);
  const [to, setTo] = useState(toIso);
  const [pending, start] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFrom(fromIso); setTo(toIso); }, [fromIso, toIso]);

  useShortcut("alt+f2", () => setOpen((o) => !o), {
    label: "Change period / financial year",
    group: "Navigation",
    fireInInputs: true,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const presets = fyPresets(fyStartMonth, new Date());

  const apply = (f: string, t: string) => {
    if (!f || !t) return;
    start(async () => {
      await setPeriod(f, t);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded border border-border bg-white px-2.5 py-1 text-xs font-semibold text-ink-mid transition hover:border-brand-yellow-dark hover:text-ink"
        title="Change reporting period (Alt+F2)"
      >
        <CalendarRange className="h-3.5 w-3.5 text-brand-yellow-dark" />
        <span>{label}</span>
        <Kbd chord="alt+f2" className="ml-1" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-white p-3 shadow-lg">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Financial year</div>
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((p) => (
              <button
                key={p.startYear}
                type="button"
                disabled={pending}
                onClick={() => apply(isoUtc(p.from), isoUtc(p.to))}
                className="rounded border border-border px-2 py-1 text-xs hover:border-brand-yellow-dark hover:bg-brand-yellow-pale disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="my-3 border-t border-border" />

          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Custom range</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">From</label>
              <DateField value={from} onChange={setFrom} />
            </div>
            <div>
              <label className="label">To</label>
              <DateField value={to} onChange={setTo} />
            </div>
          </div>
          <button
            type="button"
            disabled={pending || !from || !to}
            onClick={() => apply(from, to)}
            className="btn-primary mt-3 w-full justify-center text-xs"
          >
            {pending ? "Applying…" : "Apply period"}
          </button>
        </div>
      )}
    </div>
  );
}
