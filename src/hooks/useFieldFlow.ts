"use client";
import { useCallback, useEffect, useRef } from "react";

const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Visible, focusable data fields of a form, in DOM (visual) order. */
function collectFields(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Tally-style "voucher entry" field flow for a native <form>.
 *
 *   • Enter on an INPUT/SELECT → advance to the next field; the LAST field
 *     submits the form ("accept on the final field"). The next input's text is
 *     selected so you can type over it.
 *   • Backspace on an EMPTY INPUT/SELECT → retreat to the previous field with
 *     the caret at its end. A field with content keeps Backspace's normal
 *     delete-a-character behaviour, so you erase the field first and then step
 *     back — exactly like Tally.
 *   • On mount the cursor opens in the first field (Tally always does).
 *
 * Left untouched so behaviour stays predictable:
 *   • TEXTAREA — Enter/Backspace keep their defaults (newline / delete char).
 *   • Buttons  — Enter activates them (Cancel / Save).
 *   • Ctrl/⌘+Enter — reserved for the existing "submit from anywhere" shortcut.
 *
 * Usage:
 *   const { onKeyDown, formRef } = useFieldFlow();
 *   <form ref={formRef} onKeyDown={onKeyDown} className="kbd-flow"> … </form>
 *
 * The `.kbd-flow` class paints the focused field yellow (see globals.css).
 */
export function useFieldFlow(opts?: { autoFocus?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (tag !== "INPUT" && tag !== "SELECT") return; // textarea/buttons untouched

    // Enter → next field, or submit on the last.
    if (e.key === "Enter") {
      const fields = collectFields(e.currentTarget);
      const idx = fields.indexOf(target);
      if (idx === -1) return;
      e.preventDefault();
      const next = fields[idx + 1];
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement) next.select();
      } else {
        e.currentTarget.requestSubmit();
      }
      return;
    }

    // Backspace on an EMPTY field → step back to the previous field. A field
    // with content keeps the normal delete-a-character behaviour.
    if (e.key === "Backspace") {
      const isEmpty =
        tag === "SELECT" ? true : (target as HTMLInputElement).value === "";
      if (!isEmpty) return; // let it delete a character
      const fields = collectFields(e.currentTarget);
      const idx = fields.indexOf(target);
      if (idx <= 0) return; // already at the first field
      e.preventDefault();
      const prev = fields[idx - 1];
      prev.focus();
      if (prev instanceof HTMLInputElement) {
        try {
          const n = prev.value.length;
          prev.setSelectionRange(n, n); // caret at end, ready to keep erasing
        } catch {
          /* number/email inputs reject setSelectionRange — ignore */
        }
      }
    }
  }, []);

  // On mount, drop the cursor into the first field — Tally always opens with
  // the first entry box active and its contents selected, ready to type.
  useEffect(() => {
    if (opts?.autoFocus === false) return;
    const form = formRef.current;
    if (!form) return;
    const [first] = collectFields(form);
    if (first) {
      first.focus();
      if (first instanceof HTMLInputElement) first.select();
    }
  }, [opts?.autoFocus]);

  return { onKeyDown, formRef };
}
