"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/rbac";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { getActiveCompanyId } from "@/lib/company";
import { setSubLedgerOpening, signedOpening, INVENTORY_CODE } from "@/lib/accounting";

const MAX_IMPORT_ROWS = 10000;
// Opening lots are already on hand; give batches a long horizon so the
// FIFO/Batch reports don't flag them as near-expiry on day one.
const BATCH_EXPIRY_DAYS = 3650;

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

// SQLite doesn't accept isolationLevel; Postgres prod does. Detect by URL.
const isPostgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const txnOpts = isPostgres ? { isolationLevel: "Serializable" as const } : undefined;

export type OpeningImportResult = {
  /** Opening GRNs created. */
  grns: number;
  /** Line items (lots) loaded across those GRNs. */
  lines: number;
  errors: string[];
  /** Per-row failures echoed back with original columns + an Error column. */
  errorRows?: Record<string, string>[];
  /** Set when prior opening stock exists and confirmReplace was not passed. */
  needsConfirm?: boolean;
  existingGrns?: number;
};

/**
 * Bulk-load go-live opening stock as Opening GRNs (one per
 * vendor + payment-status + date + warehouse).
 *
 * Unlike the normal GRN path this:
 *   • sets isOpening=true and openingPaid per the row's Payment column,
 *   • does NOT enforce the one-vendor-per-item lock (pooled SKUs, Option B),
 *   • does NOT auto-post a purchase journal (the opening journal is a later step),
 *   • does NOT link to or bump any PO.
 *
 * Re-running replaces all existing opening stock when confirmReplace=true
 * (opening GRNs carry no journal/PO yet, so a clean delete is safe).
 */
export async function bulkImportOpeningStock(
  rows: Record<string, string>[],
  confirmReplace = false,
): Promise<OpeningImportResult> {
  await requireEditor();
  if (rows.length === 0) return { grns: 0, lines: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { grns: 0, lines: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  // Guard: refuse to silently double-load. If opening stock already exists,
  // ask the caller to confirm a full replace.
  const existingGrns = await prisma.gRN.count({ where: { companyId, isOpening: true } });
  if (existingGrns > 0 && !confirmReplace) {
    return { grns: 0, lines: 0, errors: [], needsConfirm: true, existingGrns };
  }

  const [vendors, items, warehouses, models] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.item.findMany({
      where: { companyId },
      select: {
        id: true, skuCode: true,
        vendor: { select: { model: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true, taxRate: true } },
      },
    }),
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.modelMaster.findMany({ where: { isActive: true }, select: { code: true } }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const itemBySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i]));
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));
  // Single-warehouse convenience: if exactly one warehouse exists, rows may
  // leave Warehouse Code blank and it's filled in automatically.
  const onlyWarehouseId = warehouses.length === 1 ? warehouses[0].id : null;
  const validModels = new Set(models.map((m) => m.code.toUpperCase()));

  type Line = { itemId: string; qty: number; rate: number; taxRate: number; model: string };
  type Group = {
    vendorId: string;
    paid: boolean;
    warehouseId: string;
    grnDate: string;
    items: Line[];
    firstRow: number;
  };
  const groups = new Map<string, Group>();
  const errors: string[] = [];
  const errorRows: Record<string, string>[] = [];
  const fail = (rowNum: number, src: Record<string, string>, msg: string) => {
    errors.push(`Row ${rowNum}: ${msg}`);
    errorRows.push({ Row: String(rowNum), ...src, Error: msg });
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (Object.values(r).every((v) => !v || !v.trim())) continue; // skip blank padding rows

    const skuRaw = pick(r, "SKU", "skuCode", "Sku", "sku").trim();
    const item = itemBySku.get(skuRaw.toUpperCase());
    if (!item) { fail(rowNum, r, `SKU "${skuRaw || "?"}" not in Item Master`); continue; }

    const vRaw = pick(r, "Vendor", "vendor", "Vendor Code", "vendorCode", "Vendor Name").trim();
    if (!vRaw) { fail(rowNum, r, "Vendor required"); continue; }
    const vendor = vByCode.get(vRaw.toUpperCase()) ?? vByName.get(vRaw.toUpperCase());
    if (!vendor) { fail(rowNum, r, `vendor "${vRaw}" not found`); continue; }

    const qty = parseFloat(pick(r, "Qty", "qty", "Quantity"));
    if (!Number.isFinite(qty) || qty <= 0) { fail(rowNum, r, "Qty must be > 0"); continue; }

    const rate = parseFloat(pick(r, "Cost", "cost", "Rate", "rate", "Unit Cost", "unitCost"));
    if (!Number.isFinite(rate) || rate < 0) { fail(rowNum, r, "Cost must be >= 0"); continue; }

    const gstRaw = pick(r, "GST %", "GST%", "gst", "GST", "Tax Rate", "taxRate", "Tax %");
    const taxRate = gstRaw ? parseFloat(gstRaw) : (item.priceRevisions[0]?.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) { fail(rowNum, r, "GST % must be 0-100"); continue; }

    const modelRaw = pick(r, "Model", "model").toUpperCase().trim().replace(/-/g, "_");
    const model = modelRaw || (item.priceRevisions[0]?.model ?? item.vendor.model ?? "").toUpperCase();
    if (!validModels.has(model)) { fail(rowNum, r, `unknown model "${model || "(blank)"}"`); continue; }

    const payRaw = pick(r, "Payment", "payment", "Payment Status", "paymentStatus", "Status").trim().toUpperCase();
    if (payRaw !== "PAID" && payRaw !== "PENDING") { fail(rowNum, r, `Payment must be PAID or PENDING (got "${payRaw || "blank"}")`); continue; }
    const paid = payRaw === "PAID";

    const dateRaw = pick(r, "Date", "date", "As Of", "asOf", "effectiveDate", "Effective Date").trim();
    const date = parseFlexibleDate(dateRaw);
    if (!date) { fail(rowNum, r, `invalid date "${dateRaw || "(blank)"}"`); continue; }

    const whRaw = pick(r, "Warehouse Code", "warehouseCode", "Warehouse", "warehouse").trim();
    let warehouseId: string | undefined;
    if (whRaw) {
      warehouseId = whByCode.get(whRaw.toUpperCase()) ?? whByName.get(whRaw.toUpperCase());
      if (!warehouseId) { fail(rowNum, r, `warehouse "${whRaw}" not found`); continue; }
    } else if (onlyWarehouseId) {
      warehouseId = onlyWarehouseId; // single-warehouse default
    } else {
      fail(rowNum, r, "Warehouse Code required (you have multiple warehouses)"); continue;
    }

    const grnDateIso = date.toISOString().slice(0, 10);
    const key = `${vendor.id}|${paid ? "PAID" : "PENDING"}|${grnDateIso}|${warehouseId}`;
    const line: Line = { itemId: item.id, qty, rate, taxRate, model };
    const g = groups.get(key);
    if (g) g.items.push(line);
    else groups.set(key, { vendorId: vendor.id, paid, warehouseId, grnDate: grnDateIso, items: [line], firstRow: rowNum });
  }

  // Nothing to write (all rows failed) — hand back the report, don't touch the DB.
  if (groups.size === 0) {
    return { grns: 0, lines: 0, errors, errorRows };
  }

  // Replace mode: clear prior opening stock first (cascade drops their items).
  if (existingGrns > 0) {
    await prisma.gRN.deleteMany({ where: { companyId, isOpening: true } });
  }

  let grns = 0;
  let lines = 0;
  for (const g of groups.values()) {
    try {
      await prisma.$transaction(async (tx) => {
        const docNo = await nextDocNumber("OPENING", tx); // OPS001, OPS002, …
        const grnDate = new Date(`${g.grnDate}T00:00:00.000Z`);
        const batchExp = addDays(grnDate, BATCH_EXPIRY_DAYS);
        let grandTotal = 0;
        const itemRows = g.items.map((l, idx) => {
          const net = l.qty * l.rate;
          const tax = (net * l.taxRate) / 100;
          const lineTotal = net + tax;
          grandTotal += lineTotal;
          return {
            itemId: l.itemId,
            model: l.model,
            qty: l.qty,
            rejectedQty: 0,
            rate: l.rate,
            taxRate: l.taxRate,
            taxableValue: net,
            tax,
            totalValue: lineTotal,
            batchNo: `${docNo}-${idx + 1}`,
            batchExpDate: batchExp,
          };
        });
        await tx.gRN.create({
          data: {
            companyId,
            grnNo: docNo,
            grnDate,
            type: "PURCHASE",
            isOpening: true,
            openingPaid: g.paid,
            vendorId: g.vendorId,
            warehouseId: g.warehouseId,
            total: grandTotal,
            batchRemarks: "Opening balance (go-live)",
            items: { create: itemRows },
          },
        });
      }, txnOpts);
      grns++;
      lines += g.items.length;
    } catch (e) {
      console.error("[bulkImportOpeningStock] group failed:", e);
      errors.push(`Group starting at row ${g.firstRow}: failed to create opening GRN`);
    }
  }

  if (grns > 0) await logWrite("GRN", "opening-bulk", "CREATE", null, { grns, lines, replaced: existingGrns });
  revalidatePath("/opening-stock");
  revalidatePath("/grn");
  revalidatePath("/stock");
  revalidatePath("/inventory-valuation");
  revalidatePath("/batch-report");
  revalidatePath("/warehouse-stock");
  return { grns, lines, errors, errorRows };
}

export type ItemStockImportResult = {
  itemsCreated: number;
  itemsUpdated: number;
  grns: number;
  lines: number;
  errors: string[];
  errorRows?: Record<string, string>[];
  needsConfirm?: boolean;
  existingGrns?: number;
};

/**
 * Combined go-live importer: one flat CSV carrying BOTH the item identity and
 * its opening inventory. One row = one lot; the item columns repeat across a
 * SKU's lot rows (first valid row wins for identity + default price).
 *
 * Per distinct SKU it upserts the Item; per row with Opening Qty > 0 it creates
 * an opening lot (Opening GRN line, isOpening=true, openingPaid per Payment).
 * Vendors / categories / warehouses must pre-exist; items are auto-created.
 * Pooled (Option B): the same SKU may appear under several vendors / costs.
 *
 * Re-running replaces all existing opening stock (confirm-guarded); items are
 * upserted, never deleted.
 */
export async function bulkImportItemsWithStock(
  rows: Record<string, string>[],
  confirmReplace = false,
): Promise<ItemStockImportResult> {
  await requireEditor();
  const empty = { itemsCreated: 0, itemsUpdated: 0, grns: 0, lines: 0 };
  if (rows.length === 0) return { ...empty, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) return { ...empty, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  const companyId = await getActiveCompanyId();

  const existingGrns = await prisma.gRN.count({ where: { companyId, isOpening: true } });
  if (existingGrns > 0 && !confirmReplace) {
    return { ...empty, errors: [], needsConfirm: true, existingGrns };
  }

  const [vendors, categories, warehouses, models, existing] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.category.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.modelMaster.findMany({ where: { isActive: true }, select: { code: true } }),
    prisma.item.findMany({
      where: { companyId },
      select: {
        id: true, skuCode: true, name: true,
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { transferPrice: true, taxRate: true, model: true, effectiveDate: true } },
      },
    }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const cByName = new Map(categories.map((c) => [c.name.trim().toUpperCase(), c.id]));
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));
  const validModels = new Set(models.map((m) => m.code.toUpperCase()));
  const onlyWarehouseId = warehouses.length === 1 ? warehouses[0].id : null;
  const existingBySku = new Map(existing.map((it) => [it.skuCode.toUpperCase(), it]));

  const errors: string[] = [];
  const errorRows: Record<string, string>[] = [];
  const fail = (rowNum: number, src: Record<string, string>, msg: string) => {
    errors.push(`Row ${rowNum}: ${msg}`);
    errorRows.push({ Row: String(rowNum), ...src, Error: msg });
  };

  type ItemDraft = {
    skuCode: string; name: string; hsn: string; categoryId: string;
    vendorId: string; vendorSku: string; model: string;
    transferPrice: number; taxRate: number; effectiveDate: Date;
  };
  const itemDrafts = new Map<string, ItemDraft>();
  type Lot = { skuUpper: string; vendorId: string; qty: number; rate: number; taxRate: number; model: string; paid: boolean; warehouseId: string; grnDate: string };
  const lots: Lot[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (Object.values(r).every((v) => !v || !v.trim())) continue;

    const skuCode = pick(r, "SKU Code", "skuCode", "SKU", "sku", "Sku").trim();
    if (!skuCode) { fail(rowNum, r, "SKU Code required"); continue; }
    const skuUpper = skuCode.toUpperCase();
    const exists = existingBySku.has(skuUpper);

    const vRaw = pick(r, "Vendor", "vendor", "Vendor Code", "vendorCode", "Vendor Name").trim();
    if (!vRaw) { fail(rowNum, r, "Vendor required"); continue; }
    const vendor = vByCode.get(vRaw.toUpperCase()) ?? vByName.get(vRaw.toUpperCase());
    if (!vendor) { fail(rowNum, r, `vendor "${vRaw}" not found`); continue; }

    const model = pick(r, "Model", "model").toUpperCase().trim().replace(/-/g, "_");
    if (!validModels.has(model)) { fail(rowNum, r, `unknown model "${model || "(blank)"}"`); continue; }

    const rate = parseFloat(pick(r, "Rate", "rate", "Cost", "cost", "Transfer Price", "transferPrice"));
    if (!Number.isFinite(rate) || rate < 0) { fail(rowNum, r, "Rate must be >= 0"); continue; }

    const gstRaw = pick(r, "GST %", "GST%", "gst", "GST", "Tax Rate", "taxRate", "Tax %");
    const taxRate = gstRaw ? parseFloat(gstRaw) : 0;
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) { fail(rowNum, r, "GST % must be 0-100"); continue; }

    const dateRaw = pick(r, "Date", "date", "Effective Date", "effectiveDate", "As Of").trim();
    const date = parseFlexibleDate(dateRaw);
    if (!date) { fail(rowNum, r, `invalid date "${dateRaw || "(blank)"}"`); continue; }
    const grnDate = date.toISOString().slice(0, 10);

    // Opening Qty optional — blank/0 = create the item only (no lot).
    const qtyRaw = pick(r, "Opening Qty", "openingQty", "Qty", "qty", "Quantity", "Opening Stock", "Opening").trim();
    let qty = 0;
    let paid = false;
    let warehouseId = "";
    if (qtyRaw) {
      qty = parseFloat(qtyRaw);
      if (!Number.isFinite(qty) || qty < 0) { fail(rowNum, r, "Opening Qty must be >= 0"); continue; }
      if (qty > 0) {
        const payRaw = pick(r, "Payment", "payment", "Payment Status", "Status").trim().toUpperCase();
        if (payRaw !== "PAID" && payRaw !== "PENDING") { fail(rowNum, r, `Payment must be PAID or PENDING (got "${payRaw || "blank"}")`); continue; }
        paid = payRaw === "PAID";
        const whRaw = pick(r, "Warehouse Code", "warehouseCode", "Warehouse", "warehouse").trim();
        if (whRaw) {
          const id = whByCode.get(whRaw.toUpperCase()) ?? whByName.get(whRaw.toUpperCase());
          if (!id) { fail(rowNum, r, `warehouse "${whRaw}" not found`); continue; }
          warehouseId = id;
        } else if (onlyWarehouseId) {
          warehouseId = onlyWarehouseId;
        } else {
          fail(rowNum, r, "Warehouse Code required (you have multiple warehouses)"); continue;
        }
      }
    }

    // Item identity — first valid row per SKU wins.
    if (!itemDrafts.has(skuUpper)) {
      const name = pick(r, "Name", "name", "Item Name").trim();
      if (!name && !exists) { fail(rowNum, r, "Name required for a new item"); continue; }
      const catRaw = pick(r, "Category", "category").trim();
      let categoryId = "";
      if (catRaw) {
        const id = cByName.get(catRaw.toUpperCase());
        if (!id) { fail(rowNum, r, `category "${catRaw}" not found`); continue; }
        categoryId = id;
      }
      itemDrafts.set(skuUpper, {
        skuCode,
        name: name || existingBySku.get(skuUpper)?.name || skuCode,
        hsn: pick(r, "HSN", "hsn"),
        categoryId,
        vendorId: vendor.id,
        vendorSku: pick(r, "Vendor SKU", "vendorSku", "Vendor Sku"),
        model,
        transferPrice: rate,
        taxRate,
        effectiveDate: date,
      });
    }

    if (qty > 0) {
      lots.push({ skuUpper, vendorId: vendor.id, qty, rate, taxRate, model, paid, warehouseId, grnDate });
    }
  }

  if (itemDrafts.size === 0 && lots.length === 0) {
    return { ...empty, errors, errorRows };
  }

  // ── Upsert items ────────────────────────────────────────────────────────────
  let itemsCreated = 0;
  let itemsUpdated = 0;
  const itemIdBySku = new Map<string, string>();
  for (const [skuUpper, d] of itemDrafts) {
    try {
      const ex = existingBySku.get(skuUpper);
      const revision = { transferPrice: d.transferPrice, taxRate: d.taxRate, model: d.model, effectiveDate: d.effectiveDate };
      if (ex) {
        const latest = ex.priceRevisions[0];
        const priceChanged =
          !latest ||
          latest.transferPrice !== d.transferPrice ||
          latest.taxRate !== d.taxRate ||
          latest.model !== d.model ||
          latest.effectiveDate.getTime() !== d.effectiveDate.getTime();
        await prisma.item.update({
          where: { id: ex.id },
          data: {
            name: d.name,
            hsn: d.hsn,
            categoryId: d.categoryId || null,
            vendorId: d.vendorId,
            vendorSku: d.vendorSku,
            ...(priceChanged ? { priceRevisions: { create: revision } } : {}),
          },
        });
        itemIdBySku.set(skuUpper, ex.id);
        itemsUpdated++;
      } else {
        const created = await prisma.item.create({
          data: {
            skuCode: d.skuCode,
            name: d.name,
            hsn: d.hsn,
            categoryId: d.categoryId || null,
            vendorId: d.vendorId,
            vendorSku: d.vendorSku,
            priceRevisions: { create: revision },
            companyId,
          },
          select: { id: true },
        });
        itemIdBySku.set(skuUpper, created.id);
        itemsCreated++;
      }
    } catch (e) {
      const code = typeof e === "object" && e && "code" in e ? (e as { code?: string }).code : "";
      errors.push(`Item ${d.skuCode}: ${code === "P2002" ? "duplicate SKU" : "save failed"}`);
    }
  }

  // ── Opening lots → Opening GRNs ──────────────────────────────────────────────
  if (existingGrns > 0) {
    await prisma.gRN.deleteMany({ where: { companyId, isOpening: true } });
  }

  type GLine = { itemId: string; model: string; qty: number; rate: number; taxRate: number };
  type Group = { vendorId: string; paid: boolean; warehouseId: string; grnDate: string; items: GLine[] };
  const groups = new Map<string, Group>();
  for (const lot of lots) {
    const itemId = itemIdBySku.get(lot.skuUpper);
    if (!itemId) { errors.push(`Opening lot for ${lot.skuUpper}: item not created — lot skipped`); continue; }
    const key = `${lot.vendorId}|${lot.paid ? "P" : "U"}|${lot.warehouseId}|${lot.grnDate}`;
    const line: GLine = { itemId, model: lot.model, qty: lot.qty, rate: lot.rate, taxRate: lot.taxRate };
    const g = groups.get(key);
    if (g) g.items.push(line);
    else groups.set(key, { vendorId: lot.vendorId, paid: lot.paid, warehouseId: lot.warehouseId, grnDate: lot.grnDate, items: [line] });
  }

  let grns = 0;
  let lines = 0;
  for (const g of groups.values()) {
    try {
      await prisma.$transaction(async (tx) => {
        const docNo = await nextDocNumber("OPENING", tx);
        const grnDate = new Date(`${g.grnDate}T00:00:00.000Z`);
        const batchExp = addDays(grnDate, BATCH_EXPIRY_DAYS);
        let grandTotal = 0;
        const itemRows = g.items.map((l, idx) => {
          const net = l.qty * l.rate;
          const tax = (net * l.taxRate) / 100;
          const lineTotal = net + tax;
          grandTotal += lineTotal;
          return {
            itemId: l.itemId, model: l.model, qty: l.qty, rejectedQty: 0,
            rate: l.rate, taxRate: l.taxRate, taxableValue: net, tax, totalValue: lineTotal,
            batchNo: `${docNo}-${idx + 1}`, batchExpDate: batchExp,
          };
        });
        await tx.gRN.create({
          data: {
            companyId, grnNo: docNo, grnDate, type: "PURCHASE",
            isOpening: true, openingPaid: g.paid, vendorId: g.vendorId, warehouseId: g.warehouseId,
            total: grandTotal, batchRemarks: "Opening balance (go-live)", items: { create: itemRows },
          },
        });
      }, txnOpts);
      grns++;
      lines += g.items.length;
    } catch (e) {
      console.error("[bulkImportItemsWithStock] group failed:", e);
      errors.push("Failed to create one opening GRN group");
    }
  }

  if (itemsCreated + itemsUpdated > 0) {
    await logWrite("Item", "combined-bulk", "CREATE", null, { itemsCreated, itemsUpdated, grns, lines, replaced: existingGrns });
  }
  revalidatePath("/items");
  revalidatePath("/opening-stock");
  revalidatePath("/grn");
  revalidatePath("/stock");
  revalidatePath("/inventory-valuation");
  revalidatePath("/batch-report");
  revalidatePath("/warehouse-stock");
  return { itemsCreated, itemsUpdated, grns, lines, errors, errorRows };
}

export type OpeningPostResult =
  | { ok: true; inventory: number; equity: number }
  | { error: string };

/**
 * Step 3 (inventory side) — set the Inventory ledger opening from loaded stock,
 * then plug the difference to Opening Balance Equity so the Trial Balance ties
 * out. Reuses the existing Chart-of-Accounts opening-balance feature (no
 * journal voucher). Idempotent — re-run after any opening change.
 *
 *   Inventory (1140)              DR = total opening stock at cost (ex-GST)
 *   Opening Balance Equity (3300) = balancing figure across ALL ledger openings
 *
 * Vendor balances are NOT derived here — they're imported directly (per model)
 * via the Vendor Opening Balance importer and live on their own sub-ledgers;
 * this plug simply balances whatever openings are currently set.
 */
export async function postOpeningBalances(): Promise<OpeningPostResult> {
  await requireEditor();
  const companyId = await getActiveCompanyId();

  const grns = await prisma.gRN.findMany({
    where: { companyId, isOpening: true },
    select: { items: { select: { taxableValue: true } } },
  });
  const inventory = grns.reduce((s, g) => s + g.items.reduce((a, i) => a + i.taxableValue, 0), 0);

  // Inventory (1140)
  const inv = await prisma.chartOfAccount.findFirst({ where: { companyId, code: INVENTORY_CODE }, select: { id: true } });
  if (!inv) return { error: "Inventory ledger (1140) is missing — run the seed." };
  await setSubLedgerOpening(inv.id, signedOpening("ASSET", inventory, "DR"));

  // Opening Balance Equity (3300) — create under Equity (3000) if missing.
  let eq = await prisma.chartOfAccount.findFirst({ where: { companyId, code: "3300" }, select: { id: true } });
  if (!eq) {
    const parent = await prisma.chartOfAccount.findFirst({ where: { companyId, code: "3000" }, select: { id: true } });
    eq = await prisma.chartOfAccount.create({
      data: {
        companyId, code: "3300", name: "Opening Balance Equity",
        type: "EQUITY", subType: "CAPITAL", parentId: parent?.id ?? null,
        isSystem: true, isActive: true, openingBalance: 0,
      },
      select: { id: true },
    });
  }

  // Plug: Equity opening = Σ over every OTHER ledger of its (Dr−Cr) opening
  // contribution, so total debits == total credits in the opening Trial Balance.
  const others = await prisma.chartOfAccount.findMany({
    where: { companyId, NOT: { id: eq.id } },
    select: { type: true, openingBalance: true },
  });
  let imbalance = 0;
  for (const a of others) {
    const isDr = a.type === "ASSET" || a.type === "EXPENSE";
    imbalance += isDr ? a.openingBalance : -a.openingBalance;
  }
  await setSubLedgerOpening(eq.id, imbalance);

  await logWrite("ChartOfAccount", "opening-balances", "UPDATE", null, { inventory, equity: imbalance });
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  revalidatePath("/accounting/chart");
  revalidatePath("/opening-stock");
  return { ok: true, inventory, equity: imbalance };
}
