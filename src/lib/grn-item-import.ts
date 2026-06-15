/**
 * Pure parse-and-validate for the 2-column SKU + Qty CSV used by the GRN
 * line-item importer. No DOM, no Prisma — just rows in, rows out.
 *
 * Spec (locked with the user):
 *   • Header optional (auto-detected by whether any header is "SKU").
 *   • Duplicate SKUs in the file are MERGED, qty summed.
 *   • Any bad row (missing SKU, qty ≤ 0, SKU not in Item Master, SKU belongs
 *     to a different vendor) blocks the whole import — caller surfaces every
 *     error so the user can fix the file in one pass.
 *   • Blank lines are ignored silently.
 */

import { parseCsv, parseCsvHeaderless } from "@/lib/csv";

export type GrnImportItemInput = {
  id: string;
  skuCode: string;
  vendorId: string;
};

export type GrnImportLine = { itemId: string; qty: number };

export type GrnImportResult =
  | { ok: true; lines: GrnImportLine[] }
  | { ok: false; errors: string[] };

export function parseGrnItemsCsv(
  text: string,
  ctx: { vendorId: string; vendorName: string; items: GrnImportItemInput[] },
): GrnImportResult {
  // Try header-mode first; if no column called "SKU" is present, fall back
  // to headerless positional (col-0 = SKU, col-1 = Qty).
  let csvRows = parseCsv<Record<string, string>>(text);
  const hasHeader =
    csvRows.length > 0 &&
    Object.keys(csvRows[0]).some((k) => k.trim().toLowerCase() === "sku");
  if (!hasHeader) {
    csvRows = parseCsvHeaderless(text).map((cols) => ({
      SKU: cols[0] ?? "",
      Qty: cols[1] ?? "",
    }));
  }

  const itemBySku = new Map(
    ctx.items.map((it) => [it.skuCode.toUpperCase(), it] as const),
  );

  const errors: string[] = [];
  const skuToQty = new Map<string, number>();

  for (let i = 0; i < csvRows.length; i++) {
    const r = csvRows[i];
    const skuRaw = (r.SKU ?? r.sku ?? r.Sku ?? r.skuCode ?? "")
      .toString()
      .trim();
    const qtyRaw = (r.Qty ?? r.qty ?? r.Quantity ?? r.quantity ?? "")
      .toString()
      .trim();
    const rowLabel = `Row ${i + (hasHeader ? 2 : 1)}`;

    // Blank line — ignore.
    if (!skuRaw && !qtyRaw) continue;

    if (!skuRaw) {
      errors.push(`${rowLabel}: SKU missing`);
      continue;
    }
    const qty = parseFloat(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`${rowLabel}: Qty must be > 0`);
      continue;
    }
    const item = itemBySku.get(skuRaw.toUpperCase());
    if (!item) {
      errors.push(`${rowLabel}: SKU "${skuRaw}" not in Item Master`);
      continue;
    }
    if (item.vendorId !== ctx.vendorId) {
      errors.push(
        `${rowLabel}: SKU "${skuRaw}" doesn't belong to ${ctx.vendorName}`,
      );
      continue;
    }
    skuToQty.set(item.id, (skuToQty.get(item.id) ?? 0) + qty);
  }

  if (errors.length > 0) return { ok: false, errors };
  const lines: GrnImportLine[] = [...skuToQty.entries()].map(([itemId, qty]) => ({
    itemId,
    qty,
  }));
  return { ok: true, lines };
}
