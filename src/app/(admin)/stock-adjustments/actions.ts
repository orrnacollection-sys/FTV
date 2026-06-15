"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { stockAdjustmentSchema } from "@/lib/validators/stockAdjustment";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 5000;

type Result =
  | { ok: true; id: string; adjNo: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

async function ensureAdjSeries() {
  // No-op since #134 — `nextDocNumber()` auto-creates per-company.
}

export async function createStockAdjustment(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const parsed = stockAdjustmentSchema.safeParse({
    date: String(fd.get("date") ?? ""),
    itemId: String(fd.get("itemId") ?? ""),
    warehouseId: String(fd.get("warehouseId") ?? ""),
    direction: String(fd.get("direction") ?? "ADD"),
    qty: String(fd.get("qty") ?? ""),
    reason: String(fd.get("reason") ?? ""),
    notes: String(fd.get("notes") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const date = parseFlexibleDate(parsed.data.date);
  if (!date) return { error: "Invalid date", fieldErrors: { date: "Use a valid date" } };

  const qtyChange = parsed.data.direction === "REMOVE" ? -parsed.data.qty : parsed.data.qty;
  const companyId = await getActiveCompanyId();

  await ensureAdjSeries();
  let createdId = "";
  let adjNo = "";
  try {
    const created = await prisma.$transaction(async (tx) => {
      const no = await nextDocNumber("SA", tx);
      return tx.stockAdjustment.create({
        data: {
          companyId,
          adjNo: no,
          date,
          itemId: parsed.data.itemId,
          warehouseId: parsed.data.warehouseId ?? null,
          qtyChange,
          reason: parsed.data.reason,
          notes: parsed.data.notes ?? null,
          createdBy: me.id,
        },
      });
    });
    createdId = created.id;
    adjNo = created.adjNo ?? "";
  } catch {
    return { error: "Failed to record adjustment" };
  }

  await logWrite("StockAdjustment", createdId, "CREATE", null, { adjNo, itemId: parsed.data.itemId, qtyChange });
  revalidatePath("/stock-adjustments");
  revalidatePath("/stock");
  return { ok: true, id: createdId, adjNo };
}

export async function deleteStockAdjustment(id: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const before = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!before) return { error: "Adjustment not found" };
  await prisma.stockAdjustment.delete({ where: { id } });
  await logWrite("StockAdjustment", id, "DELETE", before, null);
  revalidatePath("/stock-adjustments");
  revalidatePath("/stock");
  return { ok: true };
}

type ImportResult = { created: number; errors: string[] };

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export async function bulkImportAdjustments(rows: Record<string, string>[]): Promise<ImportResult> {
  const me = await requireAdmin();
  if (rows.length === 0) return { created: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) return { created: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  const companyId = await getActiveCompanyId();

  const [items, warehouses] = await Promise.all([
    prisma.item.findMany({ where: { companyId }, select: { id: true, skuCode: true } }),
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
  ]);
  const bySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i.id]));
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));

  await ensureAdjSeries();
  let created = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = `Row ${i + 1}`;

    const sku = pick(r, "SKU", "skuCode", "Sku", "sku").trim().toUpperCase();
    const itemId = bySku.get(sku);
    if (!itemId) { errors.push(`${label}: SKU "${sku || "?"}" not in Item Master`); continue; }

    const date = parseFlexibleDate(pick(r, "Date", "date"));
    if (!date) { errors.push(`${label}: invalid date`); continue; }

    // Accept a signed "Qty Change" OR a Direction + positive Qty.
    let qtyChange: number;
    const signed = pick(r, "Qty Change", "qtyChange", "Adjustment");
    if (signed) {
      qtyChange = parseFloat(signed);
      if (Number.isNaN(qtyChange) || qtyChange === 0) { errors.push(`${label}: Qty Change must be a non-zero number`); continue; }
    } else {
      const qty = parseFloat(pick(r, "Qty", "qty", "Quantity") || "0");
      if (Number.isNaN(qty) || qty <= 0) { errors.push(`${label}: Qty must be > 0`); continue; }
      const dir = pick(r, "Direction", "direction", "Type").toUpperCase().trim();
      const remove = ["REMOVE", "OUT", "-", "MINUS", "DECREASE"].includes(dir);
      qtyChange = remove ? -qty : qty;
    }

    const whRaw = pick(r, "Warehouse", "warehouse", "Warehouse Code", "warehouseCode").trim();
    let warehouseId: string | null = null;
    if (whRaw) {
      warehouseId = whByCode.get(whRaw.toUpperCase()) ?? whByName.get(whRaw.toUpperCase()) ?? null;
      if (!warehouseId) { errors.push(`${label}: warehouse "${whRaw}" not found`); continue; }
    }

    const reason = pick(r, "Reason", "reason").trim();
    if (!reason) { errors.push(`${label}: reason required`); continue; }
    const notes = pick(r, "Notes", "notes") || null;

    try {
      await prisma.$transaction(async (tx) => {
        const no = await nextDocNumber("SA", tx);
        await tx.stockAdjustment.create({
          data: { companyId, adjNo: no, date, itemId, warehouseId, qtyChange, reason, notes, createdBy: me.id },
        });
      });
      created++;
    } catch {
      errors.push(`${label}: save failed`);
    }
  }

  if (created > 0) await logWrite("StockAdjustment", "bulk", "CREATE", null, { count: created });
  revalidatePath("/stock-adjustments");
  revalidatePath("/stock");
  return { created, errors };
}
