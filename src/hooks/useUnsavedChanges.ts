"use client";
import { useEffect } from "react";
import { useShortcut } from "@/hooks/useShortcut";

/**
 * Form-level Esc handler.
 *  - While the form is dirty, Esc shows a confirm; on OK we run `onConfirmExit`.
 *  - While the form is dirty, beforeunload fires the browser's "leave site?".
 *  - When the form is clean, Esc still exits via `onConfirmExit` (no prompt).
 *
 * Registered through the shared ShortcutContext so the modal/dropdown layer
 * (registered later) naturally wins over this — Esc on an open SkuPicker
 * dropdown just closes the dropdown, not the whole form.
 */
export function useUnsavedChanges(
  isDirty: boolean,
  onConfirmExit: () => void,
  message = "You have unsaved changes. Discard them?",
) {
  // Browser-level guard for tab close / hard reload while dirty.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Esc on the form: confirm if dirty, exit either way.
  useShortcut(
    "escape",
    () => {
      if (isDirty) {
        if (window.confirm(message)) onConfirmExit();
      } else {
        onConfirmExit();
      }
    },
    // fireInInputs: the cursor auto-focuses the first field, so Esc must work
    // even while focus is inside an input/select — otherwise it does nothing.
    { label: isDirty ? "Discard changes" : "Cancel", group: "Form", fireInInputs: true },
  );
}
