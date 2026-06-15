"use client";
import { useShortcutCtx } from "@/components/ShortcutContext";

/**
 * Small "? shortcuts" hint that lives in the Topbar. Click → open cheatsheet.
 * Hidden on small screens (shortcuts are a desktop-only affordance).
 */
export function ShortcutHint() {
  const { setCheatsheetOpen } = useShortcutCtx();
  return (
    <button
      type="button"
      onClick={() => setCheatsheetOpen(true)}
      title="Show keyboard shortcuts"
      className="hidden md:inline-flex items-center gap-1 rounded border border-border bg-surface-gray-100 px-2 py-1 text-[10px] font-bold text-ink-faint hover:bg-brand-yellow-pale"
    >
      ? shortcuts
    </button>
  );
}
