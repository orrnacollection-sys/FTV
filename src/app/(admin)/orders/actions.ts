"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { logWrite } from "@/lib/audit";
import { upsertSaleForOrder } from "@/lib/order-sale-sync";
import { postSaleJournal, reverseAutoJournal } from "@/lib/accounting";
import { nextDocNumber } from "@/lib/series";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 10000;

type ImportResult = { imported: number; skipped: number; errors: string[] };
type CsvRow = Record<string, string>;

function pick(r: CsvRow, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

function num(v: string): number {
  const n = parseFloat((v || "").toString().replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Import Order lines in the "Common Order" format:
 *   Date | SKU | Marketplace | Type | Place of Supply | QTY |
 *   Sale Price (Unit Rate) | Taxable Value | GST Rate % | CGST | SGST | IGST | Total
 *
 * Each row creates one MarketplaceOrder AND its paired Sale row inside the
 * same per-row transaction — `upsertSaleForOrder` does the projection.
 * If any one row's sync fails, that row is rolled back and reported, but
 * other rows in the batch continue (per-row tx).
 */
export async function importMarketplaceOrders(rows: CsvRow[]): Promise<ImportResult> {
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

  const errors: string[] = [];
  let imported = 0;
  const createdOrderIds: string[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const label = `Row ${idx + 1}`;
    const sku = pick(r, "SKU", "skuCode", "Sku", "sku").trim().toUpperCase();
    const itemId = bySku.get(sku);
    if (!itemId) { errors.push(`${label}: SKU "${sku}" not in Item Master`); continue; }

    const dateRaw = pick(r, "Date", "date", "Order Date");
    const date = parseFlexibleDate(dateRaw);
    if (!date) { errors.push(`${label}: invalid date "${dateRaw}"`); continue; }

    const marketplace = pick(r, "Marketplace", "marketplace", "Channel").trim();
    if (!marketplace) { errors.push(`${label}: marketplace required`); continue; }

    const typeRaw = (pick(r, "Type", "type", "Transaction Type") || "SALE").toUpperCase();
    const type = typeRaw === "RETURN" ? "RETURN" : typeRaw === "RTO" ? "RTO" : "SALE";

    const channelRaw = (pick(r, "Channel Type", "channelType", "Order Channel") || "").toUpperCase();
    const channel =
      channelRaw === "DIRECT" || channelRaw === "WEBSITE" || channelRaw === "MARKETPLACE"
        ? channelRaw
        : "MARKETPLACE";

    const qty = num(pick(r, "QTY", "Qty", "qty", "Quantity"));
    const salePrice = num(pick(r, "Sale Price (Unit Rate)", "Sale Price", "salePrice", "Unit Rate", "Rate"));
    // Transfer Price (vendor side). If CSV provides it, use it. Otherwise
    // auto-resolve from ItemPriceRevision at the order date — same lookup
    // the Vendor Ledger uses for payouts.
    let transferPrice = num(pick(r, "Transfer Price (Vendor Rate)", "Transfer Price", "transferPrice", "Vendor Rate"));
    if (transferPrice === 0) {
      const rev = await prisma.itemPriceRevision.findFirst({
        where: { itemId, effectiveDate: { lte: date } },
        orderBy: { effectiveDate: "desc" },
        select: { transferPrice: true },
      });
      transferPrice = rev?.transferPrice ?? 0;
    }
    let taxableValue = num(pick(r, "Taxable Value", "taxableValue", "Taxable"));
    const gstRate = num(pick(r, "GST Rate %", "GST Rate", "gstRate", "GST%"));
    const cgst = num(pick(r, "CGST", "cgst"));
    const sgst = num(pick(r, "SGST", "sgst"));
    const igst = num(pick(r, "IGST", "igst"));
    let total = num(pick(r, "Total", "total", "Total Value"));

    if (taxableValue === 0 && qty !== 0 && salePrice !== 0) taxableValue = qty * salePrice;
    if (total === 0) total = taxableValue + cgst + sgst + igst;
    if (qty === 0 && taxableValue === 0) { errors.push(`${label}: qty and taxable value both zero`); continue; }

    try {
      const orderId = await prisma.$transaction(async (tx) => {
        // Import rows arrive as marketplace dumps by default — most don't
        // need their own invoice number. Honor a per-row "Invoice No" column
        // when admin pre-populates it; otherwise auto-assign for non-
        // MARKETPLACE channel + SALE type. Skips RETURN / RTO rows
        // because credit notes use the original invoice's number.
        const explicitInv = pick(r, "Invoice No", "invoiceNo", "Invoice Number").trim();
        const autoInvoice = !explicitInv && channel !== "MARKETPLACE" && type === "SALE"
          ? await nextDocNumber("INV", tx)
          : null;
        const invoiceNo = explicitInv || autoInvoice || null;
        const order = await tx.marketplaceOrder.create({
          data: {
            companyId,
            date,
            itemId,
            marketplace,
            channel,
            type,
            placeOfSupply: pick(r, "Place of Supply", "placeOfSupply", "POS", "State") || null,
            qty,
            salePrice,
            transferPrice,
            taxableValue,
            gstRate,
            cgst,
            sgst,
            igst,
            total,
            remarks: pick(r, "Remarks", "remarks", "Notes") || null,
            invoiceNo,
            invoiceDate: invoiceNo ? date : null,
            createdBy: me.id,
          },
          select: { id: true },
        });
        await upsertSaleForOrder(order.id, tx);
        return order.id;
      });
      createdOrderIds.push(orderId);
      imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      errors.push(`${label}: ${msg}`);
    }
  }

  if (imported > 0) {
    await logWrite("MarketplaceOrder", "bulk", "CREATE", null, { count: imported, withPairedSale: true });
    // Auto-post one JV per imported order. Failures are logged but don't
    // roll back the imports — books reconciliation happens out-of-band.
    for (const id of createdOrderIds) {
      const res = await postSaleJournal(id);
      if ("error" in res) console.error(`[importMarketplaceOrders] postSaleJournal failed for ${id}: ${res.error}`);
    }
    revalidatePath("/orders");
    revalidatePath("/marketplace-orders");
    revalidatePath("/sales");
    revalidatePath("/accounting/journal");
    revalidatePath("/accounting/trial-balance");
    revalidatePath("/accounting/balance-sheet");
  }
  return { imported, skipped: errors.length, errors };
}

// ── Single-row Record Sale (admin types one Order on /orders) ──────────────

type OrderCreateInput = {
  date: string;        // ISO YYYY-MM-DD or DD-MM-YYYY (parseFlexibleDate)
  itemId: string;
  marketplace: string;
  channel: string;
  type: string;
  placeOfSupply?: string | null;
  /** Optional warehouse — drives ship-from state for intra/inter-state tax math. */
  warehouseId?: string | null;
  /** Optional customer — drives B2B / B2C classification via gstRegType. */
  customerId?: string | null;
  qty: number;
  salePrice: number;
  transferPrice?: number; // optional — auto-resolve if zero/undefined
  taxableValue?: number;  // optional — auto-compute if zero
  gstRate: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total?: number;         // optional — auto-compute if zero
  remarks?: string;
};

type CreateOrderResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createOrder(input: OrderCreateInput): Promise<CreateOrderResult> {
  const me = await requireAdmin();

  const date = parseFlexibleDate(input.date);
  if (!date) return { ok: false, error: "Invalid date" };

  if (!input.itemId) return { ok: false, error: "SKU is required" };
  if (!input.marketplace.trim()) return { ok: false, error: "Marketplace / channel name is required" };
  if (input.qty <= 0) return { ok: false, error: "Quantity must be positive" };
  if (input.salePrice < 0) return { ok: false, error: "Sale price can't be negative" };

  const type = ["SALE", "RETURN", "RTO"].includes(input.type) ? input.type : "SALE";
  const channel = ["MARKETPLACE", "DIRECT", "WEBSITE"].includes(input.channel) ? input.channel : "DIRECT";

  // Resolve transferPrice from ItemPriceRevision if admin left it blank.
  let transferPrice = input.transferPrice ?? 0;
  if (transferPrice === 0) {
    const rev = await prisma.itemPriceRevision.findFirst({
      where: { itemId: input.itemId, effectiveDate: { lte: date } },
      orderBy: { effectiveDate: "desc" },
      select: { transferPrice: true },
    });
    transferPrice = rev?.transferPrice ?? 0;
  }

  const taxableValue = input.taxableValue && input.taxableValue > 0
    ? input.taxableValue
    : input.qty * input.salePrice;
  const cgst = input.cgst ?? 0;
  const sgst = input.sgst ?? 0;
  const igst = input.igst ?? 0;
  const total = input.total && input.total > 0
    ? input.total
    : taxableValue + cgst + sgst + igst;

  // Non-marketplace channels (DIRECT, WEBSITE) need a real invoice number
  // for GSTR-1 + the printable tax invoice. Marketplace orders get null and
  // roll into the B2C-Small summary on GSTR-1 Section 7.
  const needsInvoice = channel !== "MARKETPLACE" && type === "SALE";

  const companyId = await getActiveCompanyId();
  try {
    const id = await prisma.$transaction(async (tx) => {
      const invoiceNo = needsInvoice ? await nextDocNumber("INV", tx) : null;
      const order = await tx.marketplaceOrder.create({
        data: {
          companyId,
          date,
          itemId: input.itemId,
          marketplace: input.marketplace.trim(),
          channel,
          type,
          placeOfSupply: input.placeOfSupply?.trim() || null,
          warehouseId: input.warehouseId?.trim() || null,
          customerId: input.customerId?.trim() || null,
          qty: input.qty,
          salePrice: input.salePrice,
          transferPrice,
          taxableValue,
          gstRate: input.gstRate,
          cgst,
          sgst,
          igst,
          total,
          remarks: input.remarks?.trim() || null,
          invoiceNo,
          invoiceDate: invoiceNo ? date : null,
          createdBy: me.id,
        },
        select: { id: true },
      });
      await upsertSaleForOrder(order.id, tx);
      return order.id;
    });
    await logWrite("MarketplaceOrder", id, "CREATE", null, { ...input, channel, type });
    const jvRes = await postSaleJournal(id);
    if ("error" in jvRes) console.error(`[createOrder] postSaleJournal failed for ${id}: ${jvRes.error}`);
    revalidatePath("/accounting/journal");
    revalidatePath("/accounting/trial-balance");
    revalidatePath("/accounting/balance-sheet");
    revalidatePath("/orders");
    revalidatePath("/sales");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create order" };
  }
}

/** Lookup helper called when the Record Sale form changes SKU + date —
 *  returns the auto-fillable defaults so admin doesn't have to type them. */
export async function lookupOrderDefaults(itemId: string, dateStr: string): Promise<{
  transferPrice: number | null;
  gstRate: number | null;
  hsn: string | null;
  unresolved: boolean;
}> {
  await requireAdmin();
  const date = parseFlexibleDate(dateStr) ?? new Date();
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { hsn: true },
  });
  const rev = await prisma.itemPriceRevision.findFirst({
    where: { itemId, effectiveDate: { lte: date } },
    orderBy: { effectiveDate: "desc" },
    select: { transferPrice: true, taxRate: true },
  });
  // Also try the Tax Master (HsnRate) — it's the more authoritative source
  // for slab if Item has an HSN.
  let hsnSlab: number | null = null;
  if (item?.hsn) {
    const hr = await prisma.hsnRate.findFirst({
      where: { hsn: item.hsn, isActive: true, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: "desc" },
      select: { slabRate: true },
    });
    hsnSlab = hr?.slabRate ?? null;
  }
  return {
    transferPrice: rev?.transferPrice ?? null,
    gstRate: hsnSlab ?? rev?.taxRate ?? null,
    hsn: item?.hsn ?? null,
    unresolved: !rev && hsnSlab === null,
  };
}

/**
 * Bulk delete. Cascade-delete on Sale.sourceOrderId means the paired Sale
 * rows go away with the Orders — no extra work needed.
 */
export async function bulkDeleteMarketplaceOrders(ids: string[]): Promise<{ ok: true; count: number } | { error: string }> {
  await requireAdmin();
  if (ids.length === 0) return { error: "Nothing selected" };
  // Reverse the auto-posted journal entries BEFORE the orders disappear —
  // we identify them by sourceRefId, which we'd lose on delete.
  for (const id of ids) {
    await reverseAutoJournal("AUTO_SALE", id);
  }
  const { count } = await prisma.marketplaceOrder.deleteMany({ where: { id: { in: ids } } });
  await logWrite("MarketplaceOrder", "bulk", "DELETE", { ids }, null);
  revalidatePath("/orders");
  revalidatePath("/marketplace-orders");
  revalidatePath("/sales");
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  return { ok: true, count };
}
