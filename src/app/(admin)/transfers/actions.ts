"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { z } from "zod";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 5000;

const schema = z
  .object({
    date: z.string().min(1),
    itemId: z.string().min(1, "Item required"),
    fromWarehouseId: z.string().min(1, "From warehouse required"),
    toWarehouseId: z.string().min(1, "To warehouse required"),
    transferType: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
    qty: z.coerce.number().positive("Qty must be > 0"),
    notes: z.string().optional(),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: "From and To warehouses must differ",
    path: ["toWarehouseId"],
  });

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** No-op kept for call-site compatibility — series auto-create lives in
 *  `nextDocNumber()` now (per-company, since #134). */
async function ensureTransferSeries() {}

export async function createTransfer(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const parsed = schema.safeParse({
    date: String(fd.get("date") ?? ""),
    itemId: String(fd.get("itemId") ?? ""),
    fromWarehouseId: String(fd.get("fromWarehouseId") ?? ""),
    toWarehouseId: String(fd.get("toWarehouseId") ?? ""),
    transferType: String(fd.get("transferType") ?? ""),
    qty: String(fd.get("qty") ?? "0"),
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
  if (!date) return { error: "Invalid date" };
  const companyId = await getActiveCompanyId();

  await ensureTransferSeries();
  const t = await prisma.$transaction(async (tx) => {
    const docNo = await nextDocNumber("TR", tx);
    return tx.warehouseTransfer.create({
      data: {
        companyId,
        docNo,
        date,
        itemId: parsed.data.itemId,
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        transferType: parsed.data.transferType ?? null,
        qty: parsed.data.qty,
        notes: parsed.data.notes || null,
        createdBy: me.id,
      },
    });
  });
  await logWrite("WarehouseTransfer", t.id, "CREATE", null, { docNo: t.docNo, ...parsed.data });
  revalidatePath("/transfers");
  return { ok: true };
}

export async function deleteTransfer(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.warehouseTransfer.findUnique({ where: { id } });
  if (!before) return { error: "Not found" };
  await prisma.warehouseTransfer.delete({ where: { id } });
  await logWrite("WarehouseTransfer", id, "DELETE", before, null);
  revalidatePath("/transfers");
  return { ok: true };
}

type ImportResult = { created: number; errors: string[] };

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export async function bulkImportTransfers(rows: Record<string, string>[]): Promise<ImportResult> {
  const me = await requireAdmin();
  if (rows.length === 0) return { created: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) return { created: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  const companyId = await getActiveCompanyId();

  const skuCodes = [...new Set(rows.map((r) => pick(r, "SKU", "skuCode", "Sku", "sku")).filter(Boolean))];
  const items = await prisma.item.findMany({
    where: { companyId, skuCode: { in: skuCodes } },
    select: { id: true, skuCode: true },
  });
  const bySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i.id]));

  const warehouses = await prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } });
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));
  const resolveWh = (raw: string): string | null => {
    const v = raw.trim().toUpperCase();
    return whByCode.get(v) ?? whByName.get(v) ?? null;
  };

  await ensureTransferSeries();

  let created = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const label = `Row ${i + 1}`;

    const sku = pick(r, "SKU", "skuCode", "Sku", "sku").trim().toUpperCase();
    const itemId = bySku.get(sku);
    if (!itemId) { errors.push(`${label}: SKU "${sku || "?"}" not in Item Master`); continue; }

    const date = parseFlexibleDate(pick(r, "Date", "date", "vchDate"));
    if (!date) { errors.push(`${label}: invalid date`); continue; }

    const fromRaw = pick(r, "From", "From Warehouse", "fromWarehouse", "Source");
    const toRaw = pick(r, "To", "To Warehouse", "toWarehouse", "Destination", "Location");
    const fromWarehouseId = resolveWh(fromRaw);
    const toWarehouseId = resolveWh(toRaw);
    if (!fromWarehouseId) { errors.push(`${label}: From warehouse "${fromRaw || "?"}" not found`); continue; }
    if (!toWarehouseId) { errors.push(`${label}: To warehouse "${toRaw || "?"}" not found`); continue; }
    if (fromWarehouseId === toWarehouseId) { errors.push(`${label}: From and To must differ`); continue; }

    const qty = parseFloat(pick(r, "Qty", "qty", "Quantity") || "0") || 0;
    if (qty <= 0) { errors.push(`${label}: qty must be > 0`); continue; }

    const transferType = pick(r, "Transfer Type", "transferType", "TransferType", "Category").trim() || null;
    const notes = pick(r, "Notes", "notes", "Remarks") || null;

    try {
      await prisma.$transaction(async (tx) => {
        const docNo = await nextDocNumber("TR", tx);
        await tx.warehouseTransfer.create({
          data: { companyId, docNo, date, itemId, fromWarehouseId, toWarehouseId, transferType, qty, notes, createdBy: me.id },
        });
      });
      created++;
    } catch {
      errors.push(`${label}: save failed`);
    }
  }

  if (created > 0) await logWrite("WarehouseTransfer", "bulk", "CREATE", null, { count: created });
  revalidatePath("/transfers");
  return { created, errors };
}
