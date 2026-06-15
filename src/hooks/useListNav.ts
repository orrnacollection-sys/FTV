"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/keyboard";

/**
 * Tally-style list navigation for any master/transaction list — the behaviour
 * piloted on Vendor Master, generalised so every table wires it in ~4 lines.
 *
 *   • auto-focuses the search box on mount (highlight it amber in the markup),
 *   • live-filters `items` by `search` via the `matches` predicate,
 *   • ↑/↓ move a yellow row cursor (and stop the page scrolling),
 *   • Home/End jump to the ends, Enter opens the cursor row,
 *   • Enter in the search box opens the top (or cursor) match,
 *   • ↓ in the search box drops focus into the row cursor.
 *
 * The consumer:
 *   const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({...});
 *   <input ref={searchRef} value={q} onChange={…} onKeyDown={searchKeyDown} … />
 *   filtered.map((row, i) => <tr data-list-row={i} onMouseEnter={() => setCursor(i)}
 *       className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}> … )
 */
export function useListNav<T>({
  items,
  search,
  matches,
  onOpen,
}: {
  items: T[];
  /** Current search text (the consumer owns the input state). */
  search: string;
  /** True if the item matches the (already lowercased, non-empty) needle. */
  matches: (item: T, needle: string) => boolean;
  /** Open the row (navigate to its detail/edit page). */
  onOpen: (item: T) => void;
}) {
  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return items;
    return items.filter((it) => matches(it, n));
  }, [items, search, matches]);

  const [cursor, setCursor] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Open with the cursor in the search box, ready to type-to-find.
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Keep the cursor in range when the filter shrinks.
  useEffect(() => {
    setCursor((c) => (c >= filtered.length ? filtered.length - 1 : c));
  }, [filtered.length]);

  // Scroll the active row into view.
  useEffect(() => {
    if (cursor < 0) return;
    document.querySelector(`[data-list-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Global arrows / Enter when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const n = filteredRef.current.length;
      if (!n) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, n - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max((c < 0 ? 0 : c) - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setCursor(0);
          break;
        case "End":
          e.preventDefault();
          setCursor(n - 1);
          break;
        case "Enter": {
          const t = e.target as HTMLElement | null;
          if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return; // let buttons/links act
          if (cursorRef.current >= 0) {
            e.preventDefault();
            onOpenRef.current(filteredRef.current[cursorRef.current]);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Attach to the search input's onKeyDown. Enter opens the top/cursor match;
   *  ↓ drops focus into the row cursor. */
  const searchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const f = filteredRef.current;
      const it = cursorRef.current >= 0 ? f[cursorRef.current] : f[0];
      if (it) onOpenRef.current(it);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      searchRef.current?.blur();
      setCursor(filteredRef.current.length ? 0 : -1);
    }
  };

  return { filtered, cursor, setCursor, searchRef, searchKeyDown };
}

/** Shared classes: the amber-highlighted "type to find" search box. */
export const LIST_SEARCH_CLASS =
  "border-brand-yellow focus:border-brand-yellow-dark focus:ring-2 focus:ring-brand-yellow/60 focus:bg-brand-yellow-pale";
