/**
 * Period helpers shared by all GST returns. GST filings work on a
 * calendar-month basis ("MMYYYY" return period code on the portal).
 */

/** Parse a YYYY-MM string → { from, to } half-open range covering the
 *  whole month, both in the host TZ (good enough — Prisma stores UTC
 *  but we display in IST and one-day-off mistakes during edge times
 *  don't change the period an order falls into for any practical case). */
export function monthRange(yyyymm: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) throw new Error(`Bad period: ${yyyymm}, expected YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  // First day of next month, exclusive upper bound.
  const to = new Date(year, month, 1, 0, 0, 0, 0);
  return { from, to };
}

/** Return-period code used by the GST portal: "MMYYYY" (no separator). */
export function fpCode(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) throw new Error(`Bad period: ${yyyymm}`);
  return `${m[2]}${m[1]}`;
}

/** YYYY-MM list for the current Indian fiscal year (April → March). */
export function fiscalYearMonths(yyyymm: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) throw new Error(`Bad period: ${yyyymm}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const fyStartYear = month >= 4 ? year : year - 1;
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = ((3 + i) % 12) + 1; // 4,5,…,12,1,2,3
    const y = i < 9 ? fyStartYear : fyStartYear + 1;
    months.push(`${y}-${String(monthIdx).padStart(2, "0")}`);
  }
  return months;
}

/** Default to the previous month — GST returns are filed in the month
 *  after the period they cover (GSTR-1 by the 11th of the next month). */
export function defaultPeriod(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Pretty display for a YYYY-MM ("Apr 2026"). */
export function periodLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[Number(m[2]) - 1]} ${m[1]}`;
}
