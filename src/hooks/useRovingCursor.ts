"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/keyboard";

type Options = {
  /** Number of selectable rows in the list. */
  count: number;
  /** Fired when Enter is pressed on the active row. */
  onActivate: (index: number) => void;
  /** Turn handling off (e.g. while a modal is open). Default true. */
  enabled?: boolean;
};

/** Interactive elements that own the Enter key themselves. */
function isInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "BUTTON" || tag === "A";
}

/**
 * Tally-style roving "cursor" for a vertical list.
 *
 *   ↑ / ↓     move the highlighted row (and stop the page from scrolling)
 *   Home/End  jump to first / last row
 *   Enter     activate the current row
 *
 * Keystrokes are ignored while the user is typing in a search box / input
 * (so filtering still works) and Enter is left alone on buttons/links.
 *
 * The consumer owns rendering: highlight the row where `index === cursor`,
 * and (optionally) scroll it into view. `setCursor` lets the mouse drive the
 * same cursor on hover so keyboard + mouse stay in sync.
 */
export function useRovingCursor({ count, onActivate, enabled = true }: Options) {
  const [cursor, setCursor] = useState(-1);

  // Read the latest values inside the listener without re-binding every move.
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  // Keep the cursor in range when the list shrinks (e.g. after a filter).
  useEffect(() => {
    setCursor((c) => (c >= count ? count - 1 : c));
  }, [count]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (count === 0) return;
      if (isTypingTarget(e.target)) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, count - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => (c <= 0 ? 0 : c - 1));
          break;
        case "Home":
          e.preventDefault();
          setCursor(0);
          break;
        case "End":
          e.preventDefault();
          setCursor(count - 1);
          break;
        case "Enter":
          if (isInteractive(e.target)) return; // let buttons/links act
          if (cursorRef.current >= 0) {
            e.preventDefault();
            onActivateRef.current(cursorRef.current);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, count]);

  const reset = useCallback(() => setCursor(-1), []);

  return { cursor, setCursor, reset };
}
