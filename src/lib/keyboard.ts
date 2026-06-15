/**
 * Tiny keyboard-shortcut layer used by the global ShortcutProvider and the
 * useShortcut hook. Chords are plain strings like:
 *
 *   "mod+enter"     →  Ctrl+Enter on Win/Linux, Cmd+Enter on Mac
 *   "mod+d"
 *   "alt+v"
 *   "?"
 *   "alt+n"
 *
 * Tokens: mod | ctrl | meta | alt | shift | <single character or named key>
 * Named keys we recognise: enter, esc/escape, tab, space, up/down/left/right,
 * slash, backspace, delete. Anything else is matched against e.key directly
 * (case-insensitive for single letters).
 */

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

export type ParsedChord = {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** The non-modifier key, lowercased. */
  key: string;
};

const NAMED_KEYS: Record<string, string> = {
  enter: "enter",
  return: "enter",
  esc: "escape",
  escape: "escape",
  tab: "tab",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  slash: "/",
  backspace: "backspace",
  del: "delete",
  delete: "delete",
};

export function parseChord(chord: string): ParsedChord {
  const tokens = chord
    .toLowerCase()
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  const out: ParsedChord = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const t of tokens) {
    if (t === "mod") out.mod = true;
    else if (t === "ctrl") out.ctrl = true;
    else if (t === "meta" || t === "cmd" || t === "command") out.meta = true;
    else if (t === "alt" || t === "option") out.alt = true;
    else if (t === "shift") out.shift = true;
    else out.key = NAMED_KEYS[t] ?? t;
  }
  return out;
}

/** True iff `e` matches the parsed chord. */
export function matchEvent(e: KeyboardEvent, c: ParsedChord): boolean {
  // Resolve `mod` against the host OS.
  const wantCtrl = c.ctrl || (c.mod && !IS_MAC);
  const wantMeta = c.meta || (c.mod && IS_MAC);
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.metaKey !== wantMeta) return false;
  if (e.altKey !== c.alt) return false;
  // Shift is special — "?" comes through as shift+/ on US layouts but the
  // user only wrote "?", so we ignore the shift bit when the chord's key is
  // a single printable character. For named keys we honour the shift flag.
  const isPrintable = c.key.length === 1;
  if (!isPrintable && e.shiftKey !== c.shift) return false;
  if (isPrintable && c.shift && !e.shiftKey) return false;

  const k = (e.key || "").toLowerCase();
  return k === c.key;
}

/** Human-readable chord, "Ctrl+Enter" / "⌘+Enter" / "Alt+V" / "?". */
export function formatChord(chord: string): string {
  const c = parseChord(chord);
  const parts: string[] = [];
  if (c.ctrl || (c.mod && !IS_MAC)) parts.push("Ctrl");
  if (c.meta || (c.mod && IS_MAC)) parts.push(IS_MAC ? "⌘" : "Win");
  if (c.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (c.shift) parts.push("Shift");
  if (c.key) parts.push(pretty(c.key));
  return parts.join(" + ");
}

function pretty(key: string): string {
  switch (key) {
    case "enter": return "Enter";
    case "escape": return "Esc";
    case "tab": return "Tab";
    case " ": return "Space";
    case "arrowup": return "↑";
    case "arrowdown": return "↓";
    case "arrowleft": return "←";
    case "arrowright": return "→";
    case "/": return "/";
    case "backspace": return "⌫";
    case "delete": return "Del";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Should this event be ignored because the user is typing in a field? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
