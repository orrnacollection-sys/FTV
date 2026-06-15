"use client";
import { formatChord } from "@/lib/keyboard";

/**
 * Visual key-cap badge. Renders a chord string ("mod+enter") as the platform
 * label ("Ctrl + Enter" / "⌘ + Enter"). Hidden on small screens by default —
 * shortcuts are a desktop-only affordance.
 */
export function Kbd({
  chord,
  className = "",
  always = false,
}: {
  chord: string;
  className?: string;
  /** If true, show on mobile too (default: hidden below md). */
  always?: boolean;
}) {
  return (
    <kbd
      className={`${always ? "" : "hidden md:inline-flex"} inline-flex items-center rounded border border-border bg-surface-gray-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-ink-mid ${className}`}
    >
      {formatChord(chord)}
    </kbd>
  );
}
