// Active reporting period (Tally's "Period", Alt+F2). Server-only: reads the
// `ftv-period` cookie and falls back to the current financial year derived from
// the company's `fyStartMonth`. Reports default their date range to this.
import { cookies } from "next/headers";
import { getActiveCompany } from "@/lib/company";
import { fyRangeFor, fyLabelFor } from "@/lib/fy";
import { toDisplayDate } from "@/lib/date";

export const PERIOD_COOKIE = "ftv-period";

export type ActivePeriod = {
  from: Date;
  to: Date;
  fyStartMonth: number;
  fyStartYear: number;
  /** "FY 2026-27" for a full FY, else "dd-mm-yyyy → dd-mm-yyyy". */
  label: string;
  isFullFy: boolean;
};

export async function getActivePeriod(): Promise<ActivePeriod> {
  let fyStartMonth = 4;
  try {
    const company = await getActiveCompany();
    fyStartMonth = company.fyStartMonth ?? 4;
  } catch {
    // No request/company context (scripts) — default to April.
  }

  let from: Date | undefined;
  let to: Date | undefined;
  try {
    const raw = (await cookies()).get(PERIOD_COOKIE)?.value;
    if (raw) {
      const [f, t] = raw.split("|");
      const fd = new Date(`${f}T00:00:00Z`);
      const td = new Date(`${t}T00:00:00Z`);
      if (!Number.isNaN(fd.getTime()) && !Number.isNaN(td.getTime())) {
        from = fd;
        to = td;
      }
    }
  } catch {
    // cookies() throws outside a request — fall through to current FY.
  }

  if (!from || !to) {
    const r = fyRangeFor(new Date(), fyStartMonth);
    from = r.from;
    to = r.to;
  }

  const fy = fyRangeFor(from, fyStartMonth);
  const isFullFy = from.getTime() === fy.from.getTime() && to.getTime() === fy.to.getTime();
  return {
    from,
    to,
    fyStartMonth,
    fyStartYear: fy.startYear,
    isFullFy,
    label: isFullFy ? fyLabelFor(fy.startYear) : `${toDisplayDate(from)} → ${toDisplayDate(to)}`,
  };
}
