"use client";
import { useRouter } from "next/navigation";
import { useShortcut } from "@/hooks/useShortcut";

/**
 * Drop on a detail page reached via a drill-down so Esc / Backspace retrace the
 * browser history (back to the report / list you came from) instead of the
 * global URL-segment ladder. fireInInputs so Esc works even from a focused
 * field. Registers after the layout's EscapeBackNav, so it wins (newest first).
 */
export function BackOnEsc() {
  const router = useRouter();
  useShortcut("escape", () => router.back(), { fireInInputs: true, label: "Back", group: "Navigation" });
  useShortcut("backspace", () => router.back(), { hidden: true });
  return null;
}
