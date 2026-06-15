"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { matchEvent, parseChord, isTypingTarget } from "@/lib/keyboard";

/**
 * Global registry of active keyboard shortcuts. The provider:
 *   • dispatches keydown to whichever registered shortcut matches first
 *     (last-registered wins, so a modal can override a page handler);
 *   • exposes the live list to the Cheatsheet (`?` overlay);
 *   • opens/closes the cheatsheet itself on "?" when nothing else swallows it.
 */

export type ShortcutMeta = {
  id: number;
  chord: string;
  label: string;
  group?: string;
  /** Hide from the `?` cheatsheet (still works). */
  hidden?: boolean;
  /** Fire even when the user is typing in an input/textarea. */
  fireInInputs?: boolean;
  handler: (e: KeyboardEvent) => void;
};

type Ctx = {
  register: (s: Omit<ShortcutMeta, "id">) => () => void;
  list: ShortcutMeta[];
  cheatsheetOpen: boolean;
  setCheatsheetOpen: (v: boolean) => void;
};

const ShortcutCtx = createContext<Ctx | null>(null);

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts, setShortcuts] = useState<ShortcutMeta[]>([]);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const idRef = useRef(0);

  const register = useCallback((s: Omit<ShortcutMeta, "id">) => {
    const id = ++idRef.current;
    setShortcuts((xs) => [...xs, { ...s, id }]);
    return () => {
      setShortcuts((xs) => xs.filter((x) => x.id !== id));
    };
  }, []);

  // Global keydown — walk shortcuts in reverse order (newest first) so the
  // most recently mounted handler wins. This makes modals naturally override
  // page-level handlers when they mount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cheatsheet open: only Esc closes it; everything else is consumed.
      if (cheatsheetOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setCheatsheetOpen(false);
        }
        return;
      }

      const typing = isTypingTarget(e.target);
      for (let i = shortcuts.length - 1; i >= 0; i--) {
        const s = shortcuts[i];
        if (typing && !s.fireInInputs && !hasModifier(s.chord)) continue;
        if (matchEvent(e, parseChord(s.chord))) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }

      // Built-in: "?" (unshifted on UK / shift+/ on US) opens the cheatsheet
      // when not typing. Skip if anything else already consumed the event.
      if (!typing && (e.key === "?" || (e.key === "/" && e.shiftKey))) {
        e.preventDefault();
        setCheatsheetOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, cheatsheetOpen]);

  const value = useMemo<Ctx>(
    () => ({ register, list: shortcuts, cheatsheetOpen, setCheatsheetOpen }),
    [register, shortcuts, cheatsheetOpen],
  );

  return <ShortcutCtx.Provider value={value}>{children}</ShortcutCtx.Provider>;
}

export function useShortcutCtx(): Ctx {
  const v = useContext(ShortcutCtx);
  if (!v) throw new Error("useShortcut must be used inside <ShortcutProvider>");
  return v;
}

function hasModifier(chord: string): boolean {
  const c = chord.toLowerCase();
  return c.includes("mod") || c.includes("ctrl") || c.includes("meta") ||
    c.includes("cmd") || c.includes("alt") || c.includes("option");
}
