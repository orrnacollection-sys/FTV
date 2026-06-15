"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { parseFlexibleDate } from "@/lib/date";
import { isoUtc } from "@/lib/fy";

const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyy-mm-dd → dd-mm-yyyy, string-only (no timezone drift). */
function displayIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
function monthOf(iso: string): Date {
  const d = iso ? new Date(`${iso}T00:00:00Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function buildMonth(view: Date): (Date | null)[] {
  const y = view.getUTCFullYear();
  const mo = view.getUTCMonth();
  const startWd = new Date(Date.UTC(y, mo, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(Date.UTC(y, mo, d)));
  return cells;
}

/**
 * Tally-style date field: type any format (dd-mm-yy, dd/mm/yyyy, yyyy-mm-dd…)
 * or pick from a calendar popup. Emits ISO `yyyy-mm-dd` via onChange.
 * Set `enableF2` on the primary voucher date so F2 opens its calendar.
 */
export function DateField({
  value,
  onChange,
  name,
  required,
  enableF2,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (iso: string) => void;
  name?: string;
  required?: boolean;
  enableF2?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(displayIso(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => monthOf(value));
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(displayIso(value)); }, [value]);

  useShortcut(
    "f2",
    () => { setView(monthOf(value)); setOpen(true); inputRef.current?.focus(); },
    { enabled: !!enableF2, fireInInputs: true, label: "Pick date", group: "Form" },
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commitText = () => {
    const t = text.trim();
    if (!t) { onChange(""); return; }
    // Day+month-only input ("20.5") fills in the field's current year, else today's.
    const defaultYear = value ? Number(value.slice(0, 4)) : new Date().getUTCFullYear();
    const d = parseFlexibleDate(t, defaultYear);
    if (d) { onChange(isoUtc(d)); setText(displayIso(isoUtc(d))); }
    else { setText(displayIso(value)); } // revert unparseable input
  };

  const pick = (d: Date) => {
    onChange(isoUtc(d));
    setOpen(false);
    inputRef.current?.focus();
  };

  const grid = useMemo(() => buildMonth(view), [view]);
  const todayIso = isoUtc(new Date());

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          required={required}
          placeholder="dd-mm-yyyy"
          inputMode="numeric"
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitText(); setOpen(false); }
            if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          }}
          className={`input pr-9 ${className}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => { setView(monthOf(value)); setOpen((o) => !o); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:bg-brand-yellow-pale"
          title="Open calendar (F2)"
        >
          <CalIcon className="h-4 w-4" />
        </button>
      </div>
      {name && <input type="hidden" name={name} value={value} />}

      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-lg border border-border bg-white p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setView(addMonths(view, -1))} className="rounded p-1 hover:bg-brand-yellow-pale"><ChevronLeft className="h-4 w-4" /></button>
            <div className="text-sm font-bold">{MONTHS[view.getUTCMonth()]} {view.getUTCFullYear()}</div>
            <button type="button" onClick={() => setView(addMonths(view, 1))} className="rounded p-1 hover:bg-brand-yellow-pale"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-bold text-ink-faint">
            {WD.map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((d, i) => {
              if (!d) return <div key={i} />;
              const iso = isoUtc(d);
              const isSel = iso === value;
              const isToday = iso === todayIso;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(d)}
                  className={`rounded py-1 text-xs hover:bg-brand-yellow-pale ${
                    isSel ? "bg-brand-yellow font-bold text-brand-black" : isToday ? "ring-1 ring-inset ring-brand-yellow-dark" : ""
                  }`}
                >
                  {d.getUTCDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-[11px]">
            <button type="button" onClick={() => pick(new Date())} className="font-bold text-brand-yellow-dark hover:underline">Today</button>
            <span className="text-ink-faint">Type dd-mm-yy too</span>
          </div>
        </div>
      )}
    </div>
  );
}
