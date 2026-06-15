"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Keyboard-friendly SKU combobox. Substring search on SKU + name + vendor,
 * SKU-ascending order, auto-highlight first match, Tab/Enter to commit,
 * Esc to close, backspace to refine. Replaces the native <select> in every
 * line-item form.
 *
 * Dropdown renders via a React portal so it never gets clipped by parent
 * tables / overflow containers.
 */
export type SkuPickerItem = {
  id: string;
  skuCode: string;
  name: string;
  /** Optional vendor short label (e.g. "ANOK") shown on the right. */
  vendor?: string;
};

export function SkuPicker({
  items,
  value,
  onChange,
  placeholder = "Search SKU or item name…",
  disabled = false,
  autoFocus = false,
  className = "",
}: {
  items: SkuPickerItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Portal target only resolves on the client.
  useEffect(() => { setMounted(true); }, []);

  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  // Always sort by SKU ascending — independent of the order the parent passed.
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.skuCode.localeCompare(b.skuCode)),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (it) =>
        it.skuCode.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        (it.vendor?.toLowerCase().includes(q) ?? false),
    );
  }, [sorted, query]);

  // Reset highlight to top whenever the result set changes.
  useEffect(() => { setHighlight(0); }, [query, open]);

  // Recompute dropdown position relative to the viewport. Runs while open so
  // the panel tracks scroll + resize and never detaches from its input.
  const recompute = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    const onScroll = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  // Click outside closes the dropdown and restores the label.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(target);
      const inList = listRef.current?.contains(target);
      if (!inWrapper && !inList) {
        setOpen(false);
        setFocused(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const commit = (item: SkuPickerItem) => {
    onChange(item.id);
    setQuery("");
    setOpen(false);
    setFocused(false);
  };

  const clear = () => {
    onChange("");
    setQuery("");
    setOpen(true);
    setFocused(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (open && filtered.length > 0 && (query.trim().length > 0 || e.key === "Enter")) {
        // Commit on Enter always; commit on Tab only when user has typed
        // something — bare Tab on a populated field should just move focus.
        e.preventDefault();
        commit(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      // Open dropdown → Esc just closes it; stop it bubbling so it doesn't also
      // trigger the form's exit handler. Already closed → let Esc bubble up so
      // the form's unsaved-changes prompt can fire.
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setFocused(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  // Input contents are driven by focus state, not by `open`:
  //  - focused → show the typed query (starts empty, backspace works naturally)
  //  - blurred → show the selected item's "SKU · Name" label
  // This stops Backspace from chewing into the display label and stops the
  // label from "disappearing" the moment the dropdown opens.
  const inputValue = focused
    ? query
    : selected
      ? `${selected.skuCode} · ${selected.name}`
      : "";

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); setQuery(""); }}
          onBlur={() => {
            // Defer so dropdown clicks (mousedown→commit) finish first.
            setTimeout(() => {
              if (document.activeElement !== inputRef.current) {
                setFocused(false);
                setOpen(false);
                setQuery("");
              }
            }, 100);
          }}
          onKeyDown={onKeyDown}
          placeholder={selected ? "Type to change…" : placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="input pr-7 w-full"
        />
        {(selected || query) && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:bg-surface-gray-200"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {mounted && open && !disabled && coords && createPortal(
        <div
          ref={listRef}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: Math.max(coords.width, 360),
          }}
          className="z-[100] max-h-80 overflow-auto rounded-lg border border-border bg-white shadow-xl"
          role="listbox"
        >
          {selected && (
            <div className="border-b border-border bg-brand-yellow-50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-mid">
              Currently: <span className="font-mono">{selected.skuCode}</span> · {selected.name}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink-faint">
              No items match {query ? `"${query}"` : "this filter"}.
            </div>
          ) : (
            filtered.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={idx === highlight}
                onMouseDown={(e) => { e.preventDefault(); commit(it); }}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${idx === highlight ? "bg-brand-yellow-pale" : "hover:bg-brand-yellow-50/60"}`}
              >
                <span className="w-20 shrink-0 font-mono text-xs">{it.skuCode}</span>
                <span className="flex-1 truncate">{it.name}</span>
                {it.vendor && <span className="shrink-0 text-[10px] font-mono text-ink-faint">{it.vendor}</span>}
              </button>
            ))
          )}
          {filtered.length > 0 && (
            <div className="border-t border-border bg-surface-gray-100 px-3 py-1 text-[10px] uppercase tracking-wider text-ink-faint">
              ↑↓ navigate · Enter / Tab to pick · Esc to close
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
