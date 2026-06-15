"use client";
import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/keyboard";

type Side = 0 | 1;
export type TPos = { side: Side; row: number };

type Item = { id: string };

type Options<L extends Item, R extends Item> = {
  /** Drillable accounts in the left (Dr) column. */
  left: L[];
  /** Drillable accounts in the right (Cr) column. */
  right: R[];
  /** Fired when Enter is pressed on the active account. */
  onOpen: (item: L | R) => void;
  enabled?: boolean;
};

/** Interactive elements that own the Enter key themselves. */
function isInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "BUTTON" || el.tagName === "A";
}

/**
 * Tally-style 2-D cursor for a T-account (two columns side by side).
 * Every arrow key is live:
 *
 *   ↑ / ↓   move within the current column (Dr or Cr)
 *   ← / →   jump to the other column, keeping the same row
 *   Home/End  first / last row of the current column
 *   Enter   drill into the highlighted account
 *
 * Ignored while typing in a search box; Enter is left alone on buttons/links.
 * The consumer highlights the cell where `isActive(side,row)` and may scroll
 * `[data-cell="${side}-${row}"]` into view. Hover can drive the same cursor
 * via `setPos` so mouse + keyboard stay in sync.
 */
export function useTColumnCursor<L extends Item, R extends Item>({
  left,
  right,
  onOpen,
  enabled = true,
}: Options<L, R>) {
  const [pos, setPos] = useState<TPos>({ side: 0, row: -1 });

  const posRef = useRef(pos);
  posRef.current = pos;
  const leftRef = useRef(left);
  leftRef.current = left;
  const rightRef = useRef(right);
  rightRef.current = right;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Keep the cursor in range when a column shrinks (e.g. after a date change).
  useEffect(() => {
    setPos((p) => {
      const max = (p.side === 0 ? left.length : right.length) - 1;
      return p.row > max ? { side: p.side, row: max } : p;
    });
  }, [left.length, right.length]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const L = leftRef.current.length;
      const R = rightRef.current.length;
      if (L === 0 && R === 0) return;
      const count = (side: Side) => (side === 0 ? L : R);

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setPos((p) => ({ side: p.side, row: Math.min((p.row < 0 ? -1 : p.row) + 1, count(p.side) - 1) }));
          break;
        case "ArrowUp":
          e.preventDefault();
          setPos((p) => ({ side: p.side, row: p.row <= 0 ? 0 : p.row - 1 }));
          break;
        case "ArrowRight":
          e.preventDefault();
          setPos((p) => (R === 0 ? p : { side: 1, row: Math.min(p.row < 0 ? 0 : p.row, R - 1) }));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setPos((p) => (L === 0 ? p : { side: 0, row: Math.min(p.row < 0 ? 0 : p.row, L - 1) }));
          break;
        case "Home":
          e.preventDefault();
          setPos((p) => ({ side: p.side, row: 0 }));
          break;
        case "End":
          e.preventDefault();
          setPos((p) => ({ side: p.side, row: count(p.side) - 1 }));
          break;
        case "Enter": {
          if (isInteractive(e.target)) return;
          const p = posRef.current;
          if (p.row < 0) return;
          const item = (p.side === 0 ? leftRef.current : rightRef.current)[p.row];
          if (item) {
            e.preventDefault();
            onOpenRef.current(item);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  const isActive = (side: Side, row: number) => pos.side === side && pos.row === row;
  return { pos, setPos, isActive };
}
