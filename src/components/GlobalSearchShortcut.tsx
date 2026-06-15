"use client";
import { useShortcut } from "@/hooks/useShortcut";

/**
 * Mounted once per layout. Ctrl+/ (Cmd+/ on Mac) focuses the first
 * <input type="search"> on the current page. Lets the user jump straight to
 * the filter box on any list page without using the mouse.
 */
export function GlobalSearchShortcut() {
  useShortcut(
    "mod+/",
    () => {
      const el = document.querySelector<HTMLInputElement>('input[type="search"]');
      el?.focus();
      el?.select();
    },
    { label: "Focus search", group: "Navigation" },
  );
  return null;
}
