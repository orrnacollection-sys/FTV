import { describe, it, expect } from "vitest";
import { toDisplayDate, toIsoDate, parseFlexibleDate, addDays } from "./date";

describe("date utils", () => {
  it("toDisplayDate formats as DD-MM-YYYY", () => {
    expect(toDisplayDate(new Date("2026-05-09T00:00:00Z"))).toBe("09-05-2026");
  });

  it("toDisplayDate handles null/empty", () => {
    expect(toDisplayDate(null)).toBe("");
    expect(toDisplayDate(undefined)).toBe("");
    expect(toDisplayDate("")).toBe("");
  });

  it("toIsoDate round-trips", () => {
    const d = new Date("2026-12-31T00:00:00Z");
    expect(toIsoDate(d)).toBe("2026-12-31");
  });

  it("parseFlexibleDate accepts DD-MM-YYYY", () => {
    const d = parseFlexibleDate("09-05-2026");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-09");
  });

  it("parseFlexibleDate accepts YYYY-MM-DD", () => {
    const d = parseFlexibleDate("2026-05-09");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-09");
  });

  it("parseFlexibleDate returns null on garbage", () => {
    expect(parseFlexibleDate("not a date")).toBe(null);
    expect(parseFlexibleDate("")).toBe(null);
  });

  it("addDays does the obvious thing", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(toIsoDate(addDays(start, 120))).toBe("2026-05-01");
  });
});
