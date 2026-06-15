import { describe, it, expect } from "vitest";
import { parseGrnItemsCsv } from "./grn-item-import";

const ITEMS = [
  { id: "i-100", skuCode: "KUR-001", vendorId: "v-anok" },
  { id: "i-101", skuCode: "KUR-002", vendorId: "v-anok" },
  { id: "i-200", skuCode: "SAR-001", vendorId: "v-raj" }, // belongs to a different vendor
];

const CTX = { vendorId: "v-anok", vendorName: "Anokhi Textiles", items: ITEMS };

describe("parseGrnItemsCsv", () => {
  it("parses a clean 2-column CSV with header", () => {
    const csv = "SKU,Qty\nKUR-001,5\nKUR-002,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines).toEqual([
        { itemId: "i-100", qty: 5 },
        { itemId: "i-101", qty: 3 },
      ]);
    }
  });

  it("parses a headerless 2-column CSV (auto-detect)", () => {
    const csv = "KUR-001,5\nKUR-002,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines).toEqual([
        { itemId: "i-100", qty: 5 },
        { itemId: "i-101", qty: 3 },
      ]);
    }
  });

  it("merges duplicate SKUs and sums qty", () => {
    const csv = "SKU,Qty\nKUR-001,5\nKUR-002,3\nKUR-001,2\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Two unique SKUs, KUR-001 totals 7.
      expect(res.lines).toHaveLength(2);
      const k1 = res.lines.find((l) => l.itemId === "i-100")!;
      const k2 = res.lines.find((l) => l.itemId === "i-101")!;
      expect(k1.qty).toBe(7);
      expect(k2.qty).toBe(3);
    }
  });

  it("blocks the entire import on a single bad row (unknown SKU)", () => {
    const csv = "SKU,Qty\nKUR-001,5\nNOPE-999,3\nKUR-002,2\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatch(/Row 3/);
      expect(res.errors[0]).toMatch(/NOPE-999/);
    }
  });

  it("blocks when a SKU belongs to a different vendor", () => {
    const csv = "SKU,Qty\nKUR-001,5\nSAR-001,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatch(/SAR-001/);
      expect(res.errors[0]).toMatch(/Anokhi/);
    }
  });

  it("blocks when qty is zero, negative or non-numeric", () => {
    const csv = "SKU,Qty\nKUR-001,0\nKUR-002,-3\nKUR-001,abc\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(3);
      expect(res.errors.every((e) => /Qty must be > 0/.test(e))).toBe(true);
    }
  });

  it("ignores blank lines without producing errors", () => {
    const csv = "SKU,Qty\nKUR-001,5\n\nKUR-002,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines).toHaveLength(2);
  });

  it("matches SKU case-insensitively", () => {
    const csv = "SKU,Qty\nkur-001,5\nKur-002,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines).toHaveLength(2);
  });

  it("accepts common header aliases (Quantity instead of Qty)", () => {
    const csv = "SKU,Quantity\nKUR-001,5\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].qty).toBe(5);
  });

  it("reports missing-SKU rows with their line number", () => {
    const csv = "SKU,Qty\nKUR-001,5\n,3\n";
    const res = parseGrnItemsCsv(csv, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]).toMatch(/Row 3/);
      expect(res.errors[0]).toMatch(/SKU missing/);
    }
  });
});
