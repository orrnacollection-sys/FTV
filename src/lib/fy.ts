// Financial-year math. Pure + isomorphic (no cookies / DB / next imports) so
// both server pages and the client Period popup can use it.

const pad2 = (n: number) => String(n).padStart(2, "0");

export type FyRange = { from: Date; to: Date; startYear: number };

/** The financial year that contains `date`, given the FY start month (1-12;
 *  India = 4 = April). FY runs from the 1st of the start month to the last
 *  day before the next FY. All dates are UTC midnight. */
export function fyRangeFor(date: Date, fyStartMonth: number): FyRange {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-12
  const startYear = m >= fyStartMonth ? y : y - 1;
  const from = new Date(Date.UTC(startYear, fyStartMonth - 1, 1));
  // Day 0 of the start month next year = last day of the FY.
  const to = new Date(Date.UTC(startYear + 1, fyStartMonth - 1, 0));
  return { from, to, startYear };
}

/** "FY 2026-27" from a start year. */
export function fyLabelFor(startYear: number): string {
  return `FY ${startYear}-${pad2((startYear + 1) % 100)}`;
}

/** A list of recent financial years for the picker, newest-first. */
export function fyPresets(
  fyStartMonth: number,
  around: Date,
  back = 4,
  fwd = 1,
): Array<{ startYear: number; label: string; from: Date; to: Date }> {
  const cur = fyRangeFor(around, fyStartMonth).startYear;
  const out: Array<{ startYear: number; label: string; from: Date; to: Date }> = [];
  for (let sy = cur + fwd; sy >= cur - back; sy--) {
    out.push({
      startYear: sy,
      label: fyLabelFor(sy),
      from: new Date(Date.UTC(sy, fyStartMonth - 1, 1)),
      to: new Date(Date.UTC(sy + 1, fyStartMonth - 1, 0)),
    });
  }
  return out;
}

/** ISO yyyy-mm-dd in UTC (for cookies / query params). */
export function isoUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
