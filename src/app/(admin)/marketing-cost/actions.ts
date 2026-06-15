"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { logWrite } from "@/lib/audit";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 10000;

type ImportResult = { imported: number; skipped: number; errors: string[]; needsConfirm?: boolean; overwriteCount?: number };
type CsvRow = Record<string, string>;

function pick(r: CsvRow, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

/** Normalise a Month cell to "YYYY-MM". Accepts YYYY-MM, MM-YYYY, or any date. */
function normalizeMonth(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const d = parseFlexibleDate(s);
  if (d) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return null;
}

/**
 * Import marketing spend in the format: Month | SKU | Marketing Spent.
 * Upserts per (SKU, month) so re-importing a month overwrites rather than
 * duplicates. Feeds the Marketing Cost column of the Margin Report.
 */
export async function importMarketingCost(rows: CsvRow[], confirmOverwrite = false): Promise<ImportResult> {
  const me = await requireAdmin();
  if (rows.length === 0) return { imported: 0, skipped: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { imported: 0, skipped: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  const skuCodes = [...new Set(rows.map((r) => pick(r, "SKU", "skuCode", "Sku", "sku")).filter(Boolean))];
  const items = await prisma.item.findMany({
    where: { companyId, skuCode: { in: skuCodes } },
    select: { id: true, skuCode: true },
  });
  const bySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i.id]));

  // Parse rows once into valid (itemId, month, amount) records.
  const errors: string[] = [];
  const records: { itemId: string; month: string; amount: number }[] = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const label = `Row ${idx + 1}`;
    const sku = pick(r, "SKU", "skuCode", "Sku", "sku").trim().toUpperCase();
    const itemId = bySku.get(sku);
    if (!itemId) { errors.push(`${label}: SKU "${sku}" not in Item Master`); continue; }
    const month = normalizeMonth(pick(r, "Month", "month", "Period"));
    if (!month) { errors.push(`${label}: invalid month "${pick(r, "Month", "month", "Period")}"`); continue; }
    const amount = parseFloat((pick(r, "Marketing Spent", "Marketing Cost", "marketingSpent", "Amount", "Spent") || "0").replace(/,/g, ""));
    if (!Number.isFinite(amount)) { errors.push(`${label}: invalid amount`); continue; }
    records.push({ itemId, month, amount });
  }

  // Overwrite guard: how many of these already exist (would be replaced)?
  const existing = await prisma.marketingCost.findMany({
    where: { companyId, itemId: { in: [...new Set(records.map((x) => x.itemId))] }, month: { in: [...new Set(records.map((x) => x.month))] } },
    select: { itemId: true, month: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.itemId}|${e.month}`));
  const overwriteCount = records.filter((x) => existingKeys.has(`${x.itemId}|${x.month}`)).length;
  if (overwriteCount > 0 && !confirmOverwrite) {
    return { imported: 0, skipped: errors.length, errors, needsConfirm: true, overwriteCount };
  }

  let imported = 0;
  for (const rec of records) {
    await prisma.marketingCost.upsert({
      where: { itemId_month: { itemId: rec.itemId, month: rec.month } },
      update: { amount: rec.amount, createdBy: me.id },
      create: { companyId, itemId: rec.itemId, month: rec.month, amount: rec.amount, createdBy: me.id },
    });
    imported++;
  }

  if (imported > 0) {
    await logWrite("MarketingCost", "bulk", "CREATE", null, { count: imported, overwritten: overwriteCount });
    revalidatePath("/marketing-cost");
  }
  return { imported, skipped: errors.length, errors, overwriteCount };
}

export async function bulkDeleteMarketingCost(ids: string[]): Promise<{ ok: true; count: number } | { error: string }> {
  await requireAdmin();
  if (ids.length === 0) return { error: "Nothing selected" };
  const { count } = await prisma.marketingCost.deleteMany({ where: { id: { in: ids } } });
  await logWrite("MarketingCost", "bulk", "DELETE", { ids }, null);
  revalidatePath("/marketing-cost");
  return { ok: true, count };
}
