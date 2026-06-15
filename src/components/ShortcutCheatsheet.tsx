"use client";
import { useMemo } from "react";
import { X } from "lucide-react";
import { useShortcutCtx } from "@/components/ShortcutContext";
import { Kbd } from "@/components/Kbd";

/**
 * Floating "?" overlay listing every registered shortcut for the current page,
 * grouped by `group`. Mounts in the global layout — visibility is owned by the
 * ShortcutProvider so the same "?" tap that opens it can be re-issued anywhere.
 */
export function ShortcutCheatsheet() {
  const { list, cheatsheetOpen, setCheatsheetOpen } = useShortcutCtx();

  // Group by .group, then dedupe by chord+label so duplicate registrations
  // (e.g. the same Ctrl+Enter handler in a parent and child) collapse.
  const grouped = useMemo(() => {
    const buckets = new Map<string, { chord: string; label: string }[]>();
    const seen = new Set<string>();
    for (const s of list) {
      if (s.hidden) continue;
      const key = `${s.chord}|${s.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = s.group ?? "General";
      const arr = buckets.get(g) ?? [];
      arr.push({ chord: s.chord, label: s.label });
      buckets.set(g, arr);
    }
    return Array.from(buckets.entries()).map(([group, items]) => ({ group, items }));
  }, [list]);

  if (!cheatsheetOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150">
      <div className="card relative w-full max-w-2xl max-h-[80vh] overflow-auto p-6">
        <button
          type="button"
          onClick={() => setCheatsheetOpen(false)}
          className="absolute right-3 top-3 rounded p-1 text-ink-faint hover:bg-surface-gray-100"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-1 font-display text-lg font-bold">Keyboard shortcuts</div>
        <div className="mb-5 text-[11px] text-ink-faint">
          Press <Kbd chord="?" always /> any time to open this list, <Kbd chord="esc" always /> to close.
        </div>

        {grouped.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-surface-gray-100 px-4 py-6 text-center text-xs text-ink-faint">
            No shortcuts on this page yet.
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-ink-faint">{group}</div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {items.map((s) => (
                    <div key={`${s.chord}-${s.label}`} className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-brand-yellow-50/40">
                      <span className="text-sm">{s.label}</span>
                      <Kbd chord={s.chord} always />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
