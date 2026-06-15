// DD-MM-YYYY everywhere in the UI per spec. ISO date strings for storage.

const pad = (n: number) => String(n).padStart(2, "0");

export function toDisplayDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Build a UTC date from y/m/d, returning null for impossible dates
 *  (e.g. 31-02). The round-trip check rejects rollovers. */
function makeUtcDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(`${String(y).padStart(4, "0")}-${pad(mo)}-${pad(d)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return null;
  return dt;
}

/**
 * Parse a human-typed date into a Date (UTC). Tally-flexible:
 *   - Day-first: DD-MM-YYYY, DD-MM-YY, D-M-YY  (Indian convention)
 *   - Day + month only: D-M / DD-MM  → uses `defaultYear` (the field's current
 *     year, else the current calendar year). e.g. "20.5" → 20-05-<year>
 *   - ISO:       YYYY-MM-DD
 *   - Separators: '-', '/', '.', or spaces are all accepted, interchangeably
 *   - 2-digit years map to 2000-2099 (26 → 2026)
 * Falls back to the native Date parser for anything else. Returns null on
 * an unparseable or impossible date.
 */
export function parseFlexibleDate(value: string, defaultYear?: number): Date | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  const norm = t.replace(/[/.\s]+/g, "-");

  // ISO yyyy-mm-dd (4-digit year first)
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(norm);
  if (iso) return makeUtcDate(+iso[1], +iso[2], +iso[3]);

  // Day-first dd-mm-yyyy or dd-mm-yy
  const ddmm = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(norm);
  if (ddmm) {
    const yyyy = ddmm[3].length === 2 ? 2000 + Number(ddmm[3]) : Number(ddmm[3]);
    return makeUtcDate(yyyy, +ddmm[2], +ddmm[1]);
  }

  // Day + month only ("20.5", "20-5", "20/5") — assume the default year.
  const dm = /^(\d{1,2})-(\d{1,2})$/.exec(norm);
  if (dm) {
    const y = defaultYear ?? new Date().getUTCFullYear();
    return makeUtcDate(y, +dm[2], +dm[1]);
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}
