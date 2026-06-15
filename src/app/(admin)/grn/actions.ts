"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEditor } from "@/lib/rbac";
import { grnSchema } from "@/lib/validators/grn";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { resolvePrice } from "@/lib/price-lookup";
import { postGRNJournal, reverseAutoJournal } from "@/lib/accounting";
import { getActiveCompanyId } from "@/lib/company";

const BATCH_EXPIRY_DAYS = 120;
const MAX_IMPORT_ROWS = 5000;

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

// SQLite doesn't accept isolationLevel; Postgres prod does. Detect by URL.
const isPostgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const txnOpts = isPostgres ? { isolationLevel: "Serializable" as const } : undefined;

type Result =
  | { ok: true; id: string; grnNo: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

type PoSuggestion = { poItemId: string; poNumber: string; poDate: Date; pendingQty: number };

/**
 * Suggests the oldest open PO line for a given vendor + SKU (FIFO).
 * Returns null if there's no pending line.
 */
export async function suggestPoForSku(
  vendorId: string,
  itemId: string,
): Promise<PoSuggestion | null> {
  await requireAdmin();
  // Fetch a few oldest candidates; pick the first that still has pending qty.
  // Doing this in JS (instead of one Prisma `where`) because Prisma can't compare
  // two columns from the same row directly in SQLite. 10 is plenty for FIFO.
  const candidates = await prisma.purchaseOrderItem.findMany({
    where: {
      itemId,
      po: { vendorId, status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    },
    include: { po: { select: { id: true, poNumber: true, poDate: true } } },
    orderBy: { po: { poDate: "asc" } },
    take: 10,
  });
  for (const row of candidates) {
    const pending = row.qty - row.receivedQty;
    if (pending > 0) {
      return { poItemId: row.id, poNumber: row.po.poNumber, poDate: row.po.poDate, pendingQty: pending };
    }
  }
  return null;
}

/**
 * Batched form of suggestPoForSku — one query for many SKUs at once. Used by
 * the GRN line-item importer so a 50-row import doesn't round-trip 50 times.
 */
export async function suggestPoForSkus(
  vendorId: string,
  itemIds: string[],
): Promise<Record<string, PoSuggestion>> {
  await requireEditor();
  if (itemIds.length === 0) return {};
  const candidates = await prisma.purchaseOrderItem.findMany({
    where: {
      itemId: { in: itemIds },
      po: { vendorId, status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    },
    include: { po: { select: { id: true, poNumber: true, poDate: true } } },
    orderBy: { po: { poDate: "asc" } },
  });
  const out: Record<string, PoSuggestion> = {};
  for (const row of candidates) {
    if (out[row.itemId]) continue;
    const pending = row.qty - row.receivedQty;
    if (pending > 0) {
      out[row.itemId] = { poItemId: row.id, poNumber: row.po.poNumber, poDate: row.po.poDate, pendingQty: pending };
    }
  }
  return out;
}

export async function createGRN(payload: unknown, asDraft = false): Promise<Result> {
  const me = await requireEditor();
  const parsed = grnSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const grnDate = parseFlexibleDate(parsed.data.grnDate);
  if (!grnDate) return { error: "Invalid GRN date" };
  const invDate = parsed.data.vendorInvoiceDate ? parseFlexibleDate(parsed.data.vendorInvoiceDate) : null;
  const companyId = await getActiveCompanyId();

  const items = await prisma.item.findMany({
    where: { companyId, id: { in: parsed.data.items.map((i) => i.itemId) } },
    select: { id: true, vendorId: true, vendor: { select: { model: true } } },
  });
  // Pooled SKUs (Option B): receive any item from any vendor — only verify the
  // items exist in this company.
  if (items.length !== parsed.data.items.length) {
    return { error: "One or more items don't exist" };
  }

  // Snapshot each line's model effective on the GRN date (falls back to vendor model).
  const modelByItem = new Map<string, string | null>();
  for (const it of items) {
    const resolved = await resolvePrice(it.id, grnDate);
    modelByItem.set(it.id, resolved?.model ?? it.vendor.model ?? null);
  }

  let grnId = "";
  let grnNo = "";
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Drafts skip the GRN series; they get a temp docNo until promotion.
      const docNo = asDraft ? `DRAFT-${crypto.randomUUID()}` : await nextDocNumber("GRN", tx);
      const batchExp = addDays(grnDate, BATCH_EXPIRY_DAYS);
      let grandTotal = 0;

      const rows = parsed.data.items.map((i, idx) => {
        const net = (i.qty - i.rejectedQty) * i.rate;
        const tax = (net * i.taxRate) / 100;
        const lineTotal = net + tax;
        grandTotal += lineTotal;
        return {
          itemId: i.itemId,
          poItemId: i.poItemId ?? null,
          model: modelByItem.get(i.itemId) ?? null,
          qty: i.qty,
          rejectedQty: i.rejectedQty,
          rate: i.rate,
          taxRate: i.taxRate,
          taxableValue: net,
          tax,
          totalValue: lineTotal,
          batchNo: `${docNo}-${idx + 1}`,
          batchExpDate: batchExp,
        };
      });

      // For non-RTV: bump PO receivedQty on every linked PO item.
      // Drafts don't bump PO numbers (they're not real receipts yet).
      if (!asDraft && parsed.data.type === "PURCHASE") {
        for (const i of parsed.data.items) {
          if (!i.poItemId) continue;
          const accepted = i.qty - i.rejectedQty;
          await tx.purchaseOrderItem.update({
            where: { id: i.poItemId },
            data: { receivedQty: { increment: accepted } },
          });
        }
      }

      const poIdSet = new Set<string>();
      const grn = await tx.gRN.create({
        data: {
          companyId,
          grnNo: docNo,
          grnDate,
          type: parsed.data.type,
          vendorId: parsed.data.vendorId,
          warehouseId: parsed.data.warehouseId ?? null,
          vendorInvoiceNo: parsed.data.vendorInvoiceNo ?? null,
          vendorInvoiceDate: invDate,
          total: grandTotal,
          isDraft: asDraft,
          createdBy: me.id,
          items: {
            create: await Promise.all(
              rows.map(async (r) => {
                let poId: string | null = null;
                if (r.poItemId) {
                  const poi = await tx.purchaseOrderItem.findUnique({ where: { id: r.poItemId }, select: { poId: true } });
                  poId = poi?.poId ?? null;
                  if (poId) poIdSet.add(poId);
                }
                return { ...r, poId };
              }),
            ),
          },
        },
      });

      // Recompute PO statuses touched. The increment above + this re-read are
      // both inside the txn; Serializable isolation (Postgres prod) is requested
      // below to prevent two concurrent GRNs from racing on status.
      // Drafts skip this too (they don't change PO state).
      if (asDraft) return grn;
      for (const poId of poIdSet) {
        const items = await tx.purchaseOrderItem.findMany({ where: { poId }, select: { qty: true, receivedQty: true } });
        const totalQ = items.reduce((s, i) => s + i.qty, 0);
        const recQ = items.reduce((s, i) => s + i.receivedQty, 0);
        const status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
        await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
      }

      return grn;
    }, txnOpts);
    grnId = created.id;
    grnNo = created.grnNo;
  } catch (e) {
    console.error("[createGRN] failed:", e);
    return { error: asDraft ? "Failed to save draft" : "Failed to create GRN" };
  }
  await logWrite("GRN", grnId, "CREATE", null, { grnNo, vendorId: parsed.data.vendorId, type: parsed.data.type, isDraft: asDraft });
  // Auto-post the purchase journal (skipped silently for drafts inside the
  // helper). Errors logged but never roll back the GRN.
  if (!asDraft) {
    const jvRes = await postGRNJournal(grnId);
    if ("error" in jvRes) console.error(`[createGRN] postGRNJournal failed for ${grnId}: ${jvRes.error}`);
  }
  revalidatePath("/grn");
  revalidatePath("/purchase-orders");
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  return { ok: true, id: grnId, grnNo };
}

/**
 * Edit a DRAFT GRN/RTV/RFV. Drafts haven't moved stock or bumped PO
 * receivedQty, so we just wipe + reinsert items. Header fields refresh too.
 *
 * Optional asDraft=false promotes the draft on save: allocates a real grnNo,
 * runs the same PO-bump + status-recompute path createGRN would have done.
 *
 * Refuses to touch a POSTED GRN — call updateGRNHeader for those (Stage C).
 */
export async function updateGRNDraft(
  id: string,
  payload: unknown,
  asDraft = true,
): Promise<Result> {
  const me = await requireEditor();
  const parsed = grnSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const existing = await prisma.gRN.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return { error: "GRN not found" };
  if (!existing.isDraft) return { error: "Posted GRNs are header-edit only — use the header form" };

  const grnDate = parseFlexibleDate(parsed.data.grnDate);
  if (!grnDate) return { error: "Invalid GRN date" };
  const invDate = parsed.data.vendorInvoiceDate ? parseFlexibleDate(parsed.data.vendorInvoiceDate) : null;

  // Items must still belong to the chosen vendor (drafts can change vendor).
  const itemMaster = await prisma.item.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.itemId) } },
    select: { id: true, vendorId: true, vendor: { select: { model: true } } },
  });
  if (itemMaster.length !== parsed.data.items.length) {
    return { error: "One or more items don't exist" };
  }
  // Pooled SKUs (Option B): any item from any vendor — no vendor-match check.

  // Resolve the model snapshot per item on the GRN date — same as createGRN.
  const modelByItem = new Map<string, string | null>();
  for (const it of itemMaster) {
    const resolved = await resolvePrice(it.id, grnDate);
    modelByItem.set(it.id, resolved?.model ?? it.vendor.model ?? null);
  }

  let grnNo = existing.grnNo;
  let nextIsDraft = true;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Wipe existing items — drafts have no downstream impact to roll back.
      await tx.gRNItem.deleteMany({ where: { grnId: id } });

      if (!asDraft) {
        grnNo = await nextDocNumber("GRN", tx);
        nextIsDraft = false;
      }

      const batchExp = addDays(grnDate, BATCH_EXPIRY_DAYS);
      let grandTotal = 0;
      const rows = parsed.data.items.map((i, idx) => {
        const net = (i.qty - i.rejectedQty) * i.rate;
        const tax = (net * i.taxRate) / 100;
        const lineTotal = net + tax;
        grandTotal += lineTotal;
        return {
          itemId: i.itemId,
          poItemId: i.poItemId ?? null,
          model: modelByItem.get(i.itemId) ?? null,
          qty: i.qty,
          rejectedQty: i.rejectedQty,
          rate: i.rate,
          taxRate: i.taxRate,
          taxableValue: net,
          tax,
          totalValue: lineTotal,
          batchNo: `${grnNo}-${idx + 1}`,
          batchExpDate: batchExp,
        };
      });

      // If promoting (asDraft=false) and this is a PURCHASE, bump PO receivedQty
      // + recompute PO status — mirror createGRN.
      const poIdSet = new Set<string>();
      if (!nextIsDraft && parsed.data.type === "PURCHASE") {
        for (const r of parsed.data.items) {
          if (!r.poItemId) continue;
          const accepted = r.qty - r.rejectedQty;
          const poi = await tx.purchaseOrderItem.update({
            where: { id: r.poItemId },
            data: { receivedQty: { increment: accepted } },
            select: { poId: true },
          });
          if (poi.poId) poIdSet.add(poi.poId);
        }
      }

      // Resolve poId per row so the GRNItem.poId column is correct.
      const itemRows = await Promise.all(
        rows.map(async (r) => {
          let poId: string | null = null;
          if (r.poItemId) {
            const poi = await tx.purchaseOrderItem.findUnique({ where: { id: r.poItemId }, select: { poId: true } });
            poId = poi?.poId ?? null;
          }
          return { ...r, poId };
        }),
      );

      const grn = await tx.gRN.update({
        where: { id },
        data: {
          grnNo,
          isDraft: nextIsDraft,
          grnDate,
          type: parsed.data.type,
          vendorId: parsed.data.vendorId,
          warehouseId: parsed.data.warehouseId ?? null,
          vendorInvoiceNo: parsed.data.vendorInvoiceNo ?? null,
          vendorInvoiceDate: invDate,
          total: grandTotal,
          items: {
            create: itemRows.map((r) => ({
              itemId: r.itemId, poItemId: r.poItemId, poId: r.poId, model: r.model,
              qty: r.qty, rejectedQty: r.rejectedQty, rate: r.rate, taxRate: r.taxRate,
              taxableValue: r.taxableValue, tax: r.tax, totalValue: r.totalValue,
              batchNo: r.batchNo, batchExpDate: r.batchExpDate,
            })),
          },
        },
      });

      for (const poId of poIdSet) {
        const items = await tx.purchaseOrderItem.findMany({ where: { poId }, select: { qty: true, receivedQty: true } });
        const totalQ = items.reduce((s, i) => s + i.qty, 0);
        const recQ = items.reduce((s, i) => s + i.receivedQty, 0);
        const status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
        await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
      }

      return grn;
    }, txnOpts);

    await logWrite("GRN", id, "UPDATE",
      { isDraft: existing.isDraft, grnNo: existing.grnNo, grnDate: existing.grnDate, type: existing.type, vendorId: existing.vendorId, warehouseId: existing.warehouseId },
      { isDraft: updated.isDraft, grnNo: updated.grnNo, grnDate: updated.grnDate, type: updated.type, vendorId: updated.vendorId, warehouseId: updated.warehouseId, items: parsed.data.items.length, by: me.name ?? me.id },
    );
    revalidatePath("/grn");
    revalidatePath(`/grn/${id}`);
    revalidatePath("/purchase-orders");
    return { ok: true, id: updated.id, grnNo: updated.grnNo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update draft" };
  }
}

/**
 * Header-only edit for a POSTED GRN/RTV/RFV. Fixes typo-level mistakes
 * without touching line items, money, or stock.
 *
 * Editable: grnDate, vendorInvoiceNo, vendorInvoiceDate, warehouseId,
 *           batchRemarks.
 * Frozen:   vendor, type, items, totals, grnNo.
 *
 * Why this is safe: no money or stock math changes, no PO receivedQty bump,
 * no ledger refresh. Warehouse change moves the stock pivot's attribution
 * (existing warehouse-stock derivation reads GRN.warehouseId at render time
 * — no per-item rewrite needed). grnDate moving across a model boundary
 * doesn't rewrite each GRNItem.model snapshot; that's a deliberate
 * historical record — if you need to fix model, delete + recreate.
 */
export async function updateGRNHeader(
  id: string,
  fields: {
    grnDate: string;
    vendorInvoiceNo?: string;
    vendorInvoiceDate?: string;
    warehouseId: string;
    batchRemarks?: string;
  },
): Promise<{ ok: true; id: string; grnNo: string } | { error: string }> {
  const me = await requireEditor();
  const existing = await prisma.gRN.findUnique({
    where: { id },
    select: {
      id: true, grnNo: true, isDraft: true,
      grnDate: true, vendorInvoiceNo: true, vendorInvoiceDate: true,
      warehouseId: true, batchRemarks: true,
    },
  });
  if (!existing) return { error: "GRN not found" };
  if (existing.isDraft) return { error: "Drafts use the full editor — open Edit Draft instead" };

  const grnDate = parseFlexibleDate(fields.grnDate);
  if (!grnDate) return { error: "Invalid GRN date" };
  const invDate = fields.vendorInvoiceDate ? parseFlexibleDate(fields.vendorInvoiceDate) : null;
  if (fields.vendorInvoiceDate && !invDate) return { error: "Invalid invoice date" };
  if (!fields.warehouseId) return { error: "Warehouse is required" };

  // Verify the warehouse exists. (Open-ended Z input → defensive check.)
  const wh = await prisma.warehouse.findUnique({ where: { id: fields.warehouseId }, select: { id: true } });
  if (!wh) return { error: "Warehouse not found" };

  try {
    const updated = await prisma.gRN.update({
      where: { id },
      data: {
        grnDate,
        vendorInvoiceNo: fields.vendorInvoiceNo?.trim() || null,
        vendorInvoiceDate: invDate,
        warehouseId: fields.warehouseId,
        batchRemarks: fields.batchRemarks?.trim() || null,
      },
      select: { id: true, grnNo: true },
    });
    await logWrite("GRN", id, "UPDATE",
      {
        grnDate: existing.grnDate, vendorInvoiceNo: existing.vendorInvoiceNo,
        vendorInvoiceDate: existing.vendorInvoiceDate, warehouseId: existing.warehouseId,
        batchRemarks: existing.batchRemarks,
      },
      {
        grnDate, vendorInvoiceNo: fields.vendorInvoiceNo ?? null,
        vendorInvoiceDate: invDate, warehouseId: fields.warehouseId,
        batchRemarks: fields.batchRemarks ?? null,
        by: me.name ?? me.id, mode: "header-only",
      },
    );
    revalidatePath("/grn");
    revalidatePath(`/grn/${id}`);
    revalidatePath("/warehouse-stock");
    return { ok: true, id: updated.id, grnNo: updated.grnNo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update header" };
  }
}

/** Promote a draft GRN: re-validate, allocate real GRN number, bump PO/stock. */
export async function promoteDraftGRN(id: string): Promise<Result> {
  await requireEditor();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.gRN.findUnique({ where: { id }, include: { items: true } });
      if (!draft) throw new Error("Draft not found");
      if (!draft.isDraft) throw new Error("Already promoted");
      const docNo = await nextDocNumber("GRN", tx);
      // Bump PO receivedQty + recompute PO statuses just like a fresh PURCHASE.
      if (draft.type === "PURCHASE") {
        const poIdSet = new Set<string>();
        for (const i of draft.items) {
          if (i.poItemId) {
            const accepted = i.qty - i.rejectedQty;
            await tx.purchaseOrderItem.update({ where: { id: i.poItemId }, data: { receivedQty: { increment: accepted } } });
            if (i.poId) poIdSet.add(i.poId);
          }
        }
        for (const poId of poIdSet) {
          const items = await tx.purchaseOrderItem.findMany({ where: { poId }, select: { qty: true, receivedQty: true } });
          const totalQ = items.reduce((s, x) => s + x.qty, 0);
          const recQ = items.reduce((s, x) => s + x.receivedQty, 0);
          const status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
          await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
        }
      }
      return await tx.gRN.update({ where: { id }, data: { grnNo: docNo, isDraft: false } });
    }, txnOpts);
    await logWrite("GRN", id, "UPDATE", { isDraft: true }, { isDraft: false, grnNo: result.grnNo });
    const jvRes = await postGRNJournal(id);
    if ("error" in jvRes) console.error(`[promoteDraftGRN] postGRNJournal failed for ${id}: ${jvRes.error}`);
    revalidatePath("/grn");
    revalidatePath("/purchase-orders");
    revalidatePath("/accounting/journal");
    revalidatePath("/accounting/trial-balance");
    revalidatePath("/accounting/balance-sheet");
    return { ok: true, id: result.id, grnNo: result.grnNo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to promote draft" };
  }
}

export async function deleteGRN(id: string): Promise<{ ok: true } | { error: string }> {
  await requireEditor();
  try {
    await prisma.$transaction(async (tx) => {
      const grn = await tx.gRN.findUnique({ where: { id }, include: { items: true } });
      if (!grn) throw new Error("NOT_FOUND");
      // Undo PO receivedQty bumps.
      if (grn.type === "PURCHASE") {
        for (const i of grn.items) {
          if (i.poItemId) {
            const accepted = i.qty - i.rejectedQty;
            await tx.purchaseOrderItem.update({
              where: { id: i.poItemId },
              data: { receivedQty: { decrement: accepted } },
            });
          }
        }
      }
      await tx.gRN.delete({ where: { id } });
      await logWrite("GRN", id, "DELETE", grn, null);
    });
    await reverseAutoJournal("AUTO_GRN", id);
    revalidatePath("/grn");
    revalidatePath("/purchase-orders");
    revalidatePath("/accounting/journal");
    revalidatePath("/accounting/trial-balance");
    revalidatePath("/accounting/balance-sheet");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return { error: "GRN not found" };
    return { error: "Failed to delete GRN" };
  }
}

export async function bulkDeleteGRNs(
  ids: string[],
): Promise<{ ok: true; count: number; errors: string[] } | { error: string }> {
  await requireAdmin();
  if (ids.length === 0) return { error: "Nothing selected" };
  let count = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const r = await deleteGRN(id);
    if ("ok" in r) count++;
    else errors.push(`${id.slice(0, 6)}…: ${r.error}`);
  }
  return { ok: true, count, errors };
}

type ImportResult = { created: number; errors: string[] };

/**
 * Bulk-create GRNs from CSV.
 *
 * Rows are grouped by  Vendor + Type + Date + Invoice No  into one GRN each.
 * If Invoice No is blank, the key collapses to Vendor + Type + Date — every
 * unique combination becomes its own GRN (use a unique invoice column if you
 * need to split same-day same-vendor receipts into multiple documents).
 *
 * No PO auto-link — bulk imports create stand-alone receipts. Use the manual
 * GRN builder to link to a PO and bump receivedQty.
 *
 * Per row this validates: vendor (code or name), warehouse (code or name),
 * SKU (must belong to that vendor), qty > 0, rejected ≥ 0 and ≤ qty, rate
 * ≥ 0, GST 0-100. Bad rows are skipped with a per-row message; the rest of
 * the batch still imports.
 */
export async function bulkImportGRNs(rows: Record<string, string>[]): Promise<ImportResult> {
  await requireEditor();
  if (rows.length === 0) return { created: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { created: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  const [vendors, items, warehouses] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.item.findMany({ where: { companyId }, select: { id: true, skuCode: true, vendorId: true } }),
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const itemBySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i]));
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));

  type Line = { itemId: string; qty: number; rejectedQty: number; rate: number; taxRate: number };
  type Group = {
    type: "PURCHASE" | "RTV" | "RFV";
    vendorId: string;
    warehouseId: string;
    grnDate: string;
    invoiceNo?: string;
    invoiceDate?: string;
    items: Line[];
    firstRow: number;
  };
  const groups = new Map<string, Group>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    const label = `Row ${rowNum}`;

    const dateRaw = pick(r, "Date", "date", "GRN Date", "grnDate").trim();
    const date = parseFlexibleDate(dateRaw);
    if (!date) { errors.push(`${label}: invalid date "${dateRaw}"`); continue; }

    const typeRaw = (pick(r, "Type", "type") || "PURCHASE").toUpperCase().trim();
    if (typeRaw !== "PURCHASE" && typeRaw !== "RTV" && typeRaw !== "RFV") {
      errors.push(`${label}: Type must be PURCHASE / RTV / RFV`); continue;
    }
    const type = typeRaw as "PURCHASE" | "RTV" | "RFV";

    const vRaw = pick(r, "Vendor", "vendor", "Vendor Code", "vendorCode", "Vendor Name").trim();
    if (!vRaw) { errors.push(`${label}: Vendor required`); continue; }
    const vendor = vByCode.get(vRaw.toUpperCase()) ?? vByName.get(vRaw.toUpperCase());
    if (!vendor) { errors.push(`${label}: vendor "${vRaw}" not found`); continue; }

    const whRaw = pick(r, "Warehouse", "warehouse", "Warehouse Code", "warehouseCode").trim();
    if (!whRaw) { errors.push(`${label}: Warehouse required`); continue; }
    const warehouseId = whByCode.get(whRaw.toUpperCase()) ?? whByName.get(whRaw.toUpperCase());
    if (!warehouseId) { errors.push(`${label}: warehouse "${whRaw}" not found`); continue; }

    const skuRaw = pick(r, "SKU", "skuCode", "Sku", "sku").trim();
    const sku = skuRaw.toUpperCase();
    const item = itemBySku.get(sku);
    if (!item) { errors.push(`${label}: SKU "${skuRaw || "?"}" not in Item Master`); continue; }
    // Pooled SKUs (Option B): any SKU can be received from any vendor.

    const qty = parseFloat(pick(r, "Qty", "qty", "Quantity"));
    if (!Number.isFinite(qty) || qty <= 0) { errors.push(`${label}: Qty must be > 0`); continue; }

    const rejectedRaw = pick(r, "Rejected Qty", "rejectedQty", "Rejected");
    const rejected = rejectedRaw ? parseFloat(rejectedRaw) : 0;
    if (!Number.isFinite(rejected) || rejected < 0) { errors.push(`${label}: Rejected Qty must be ≥ 0`); continue; }
    if (rejected > qty) { errors.push(`${label}: Rejected Qty (${rejected}) > Qty (${qty})`); continue; }

    const rate = parseFloat(pick(r, "Rate", "rate", "Unit Rate", "unitRate"));
    if (!Number.isFinite(rate) || rate < 0) { errors.push(`${label}: Rate must be ≥ 0`); continue; }

    const gstRaw = pick(r, "GST %", "GST%", "gst", "GST", "Tax Rate", "taxRate", "Tax %");
    const gst = gstRaw ? parseFloat(gstRaw) : 0;
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) { errors.push(`${label}: GST % must be 0-100`); continue; }

    const invoiceNo = pick(r, "Invoice No", "invoiceNo", "Invoice", "Vendor Invoice No").trim() || undefined;
    const invoiceDateRaw = pick(r, "Invoice Date", "invoiceDate").trim();
    let invoiceDateIso: string | undefined;
    if (invoiceDateRaw) {
      const d = parseFlexibleDate(invoiceDateRaw);
      if (!d) { errors.push(`${label}: invalid invoice date "${invoiceDateRaw}"`); continue; }
      invoiceDateIso = d.toISOString().slice(0, 10);
    }

    const grnDateIso = date.toISOString().slice(0, 10);
    const key = `${vendor.id}|${type}|${grnDateIso}|${invoiceNo ?? ""}`;
    const line: Line = { itemId: item.id, qty, rejectedQty: rejected, rate, taxRate: gst };
    const g = groups.get(key);
    if (g) {
      if (g.warehouseId !== warehouseId) {
        errors.push(`${label}: warehouse differs from earlier rows for same vendor+invoice+date — split into separate invoice numbers`);
        continue;
      }
      g.items.push(line);
    } else {
      groups.set(key, {
        type, vendorId: vendor.id, warehouseId,
        grnDate: grnDateIso,
        invoiceNo, invoiceDate: invoiceDateIso,
        items: [line], firstRow: rowNum,
      });
    }
  }

  let created = 0;
  for (const g of groups.values()) {
    const res = await createGRN({
      grnDate: g.grnDate,
      type: g.type,
      vendorId: g.vendorId,
      warehouseId: g.warehouseId,
      vendorInvoiceNo: g.invoiceNo,
      vendorInvoiceDate: g.invoiceDate,
      items: g.items,
    });
    if ("ok" in res) created++;
    else errors.push(`Group starting at row ${g.firstRow}: ${res.error}`);
  }

  if (created > 0) await logWrite("GRN", "bulk", "CREATE", null, { count: created });
  revalidatePath("/grn");
  revalidatePath("/purchase-orders");
  return { created, errors };
}
