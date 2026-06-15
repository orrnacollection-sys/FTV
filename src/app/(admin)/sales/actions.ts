"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, getCurrentUser } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { resolvePrice } from "@/lib/price-lookup";
import { logWrite } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { sanitizeCell } from "@/lib/csv";
import { recordSaleSchema } from "@/lib/validators/sale";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 5000;

type SaleResult =
  | { ok: true; id: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** Manual single-sale entry. Rate + tax are resolved from Item Master at vchDate. */
export async function createSale(fd: FormData): Promise<SaleResult> {
  const me = await requireAdmin();
  const parsed = recordSaleSchema.safeParse({
    vchDate: String(fd.get("vchDate") ?? ""),
    marketplace: String(fd.get("marketplace") ?? ""),
    itemId: String(fd.get("itemId") ?? ""),
    warehouseId: String(fd.get("warehouseId") ?? ""),
    transactionType: String(fd.get("transactionType") ?? "SALE"),
    qtySold: String(fd.get("qtySold") ?? "0"),
    qtyReturn: String(fd.get("qtyReturn") ?? "0"),
    qtyRTO: String(fd.get("qtyRTO") ?? "0"),
    manualRemarks: String(fd.get("manualRemarks") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const date = parseFlexibleDate(parsed.data.vchDate);
  if (!date) return { error: "Invalid date", fieldErrors: { vchDate: "Use a valid date" } };

  const companyId = await getActiveCompanyId();
  const item = await prisma.item.findFirst({
    where: { id: parsed.data.itemId, companyId },
    select: { id: true, vendorId: true, vendor: { select: { model: true } } },
  });
  if (!item) return { error: "Item not found" };

  const price = await resolvePrice(item.id, date);
  if (!price) {
    return { error: "No Item Master price on/before that date — add a price revision first." };
  }

  const sale = await prisma.sale.create({
    data: {
      companyId,
      vchDate: date,
      marketplace: parsed.data.marketplace,
      itemId: item.id,
      vendorId: item.vendorId,
      warehouseId: parsed.data.warehouseId ?? null,
      transactionType: parsed.data.transactionType,
      model: price.model ?? item.vendor.model ?? null,
      qtySold: parsed.data.qtySold,
      qtyReturn: parsed.data.qtyReturn,
      qtyRTO: parsed.data.qtyRTO,
      unitRate: price.transferPrice,
      taxRate: price.taxRate,
      manualRemarks: parsed.data.manualRemarks ?? null,
      createdBy: me.id,
    },
  });
  await logWrite("Sale", sale.id, "CREATE", null, { via: "manual", itemId: item.id, type: parsed.data.transactionType });
  revalidatePath("/sales");
  return { ok: true, id: sale.id };
}

type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};

type CsvRow = Record<string, string>;

function pick(r: CsvRow, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export async function importSales(rows: CsvRow[]): Promise<ImportResult> {
  const me = await requireAdmin();
  if (rows.length === 0) return { imported: 0, skipped: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { imported: 0, skipped: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  // Cache: skuCode → item id + vendorId + name
  const skuCodes = [...new Set(rows.map((r) => pick(r, "SKU", "skuCode", "Sku", "sku")).filter(Boolean))];
  const items = await prisma.item.findMany({
    where: { companyId, skuCode: { in: skuCodes } },
    select: { id: true, skuCode: true, vendorId: true, vendor: { select: { model: true } } },
  });
  const bySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), { id: i.id, vendorId: i.vendorId, vendorModel: i.vendor.model }]));

  const warehouses = await prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } });
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));
  const whByName = new Map(warehouses.map((w) => [w.name.trim().toUpperCase(), w.id]));

  const errors: string[] = [];
  const created: { id: string }[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const label = `Row ${idx + 1}`;
    const sku = pick(r, "SKU", "skuCode", "Sku", "sku").trim().toUpperCase();
    const itemRef = bySku.get(sku);
    if (!itemRef) { errors.push(`${label}: SKU "${sku}" not in Item Master`); continue; }

    const dateRaw = pick(r, "Date", "vchDate", "VchDate", "Vch Date", "date");
    const date = parseFlexibleDate(dateRaw);
    if (!date) { errors.push(`${label}: invalid date "${dateRaw}"`); continue; }

    const marketplace = pick(r, "Marketplace", "marketplace", "Party", "Party Name").trim();
    if (!marketplace) { errors.push(`${label}: marketplace required`); continue; }

    const txnRaw = (pick(r, "Type", "transactionType", "Transaction Type", "Txn") || "SALE").toUpperCase();
    const transactionType = txnRaw === "RETURN" ? "RETURN" : "SALE";

    const qtySold = parseFloat(pick(r, "Qty Sold", "qtySold", "Sold", "Sale") || "0") || 0;
    const qtyReturn = parseFloat(pick(r, "Qty Return", "qtyReturn", "Return") || "0") || 0;
    const qtyRTO = parseFloat(pick(r, "Qty RTO", "qtyRTO", "RTO") || "0") || 0;
    if (qtySold < 0 || qtyReturn < 0 || qtyRTO < 0) { errors.push(`${label}: negative quantities not allowed`); continue; }
    if (qtySold === 0 && qtyReturn === 0 && qtyRTO === 0) { errors.push(`${label}: all quantities zero`); continue; }

    const price = await resolvePrice(itemRef.id, date);
    if (!price) {
      errors.push(`${label}: no price revision in Item Master on/before ${dateRaw}`);
      continue;
    }

    const whRaw = pick(r, "Warehouse", "warehouse", "Warehouse Code", "warehouseCode").trim();
    let warehouseId: string | null = null;
    if (whRaw) {
      warehouseId = whByCode.get(whRaw.toUpperCase()) ?? whByName.get(whRaw.toUpperCase()) ?? null;
      if (!warehouseId) { errors.push(`${label}: warehouse "${whRaw}" not found`); continue; }
    }

    const remarks = pick(r, "Remarks", "manualRemarks") || null;

    const sale = await prisma.sale.create({
      data: {
        companyId,
        vchDate: date,
        marketplace,
        itemId: itemRef.id,
        vendorId: itemRef.vendorId,
        warehouseId,
        transactionType,
        model: price.model ?? itemRef.vendorModel ?? null,
        qtySold,
        qtyReturn,
        qtyRTO,
        unitRate: price.transferPrice,
        taxRate: price.taxRate,
        manualRemarks: remarks,
        createdBy: me.id,
      },
    });
    created.push({ id: sale.id });
  }

  if (created.length > 0) {
    await logWrite("Sale", "bulk", "CREATE", null, { count: created.length });
  }
  revalidatePath("/sales");
  return { imported: created.length, skipped: errors.length, errors };
}

export async function bulkDeleteSales(ids: string[]): Promise<{ ok: true; count: number } | { error: string }> {
  await requireAdmin();
  if (ids.length === 0) return { error: "Nothing selected" };
  const before = await prisma.sale.findMany({ where: { id: { in: ids } } });
  const { count } = await prisma.sale.deleteMany({ where: { id: { in: ids } } });
  // One audit row per deleted Sale so forensics keeps the before-state.
  for (const s of before) {
    await logWrite("Sale", s.id, "DELETE", s, null);
  }
  revalidatePath("/sales");
  return { ok: true, count };
}

type Filters = {
  marketplace?: string;
  type?: string;
  vendorId?: string;
  fromDate?: string;
  toDate?: string;
  q?: string;
};

function buildWhere(f: Filters) {
  const where: Record<string, unknown> = {};
  if (f.marketplace) where.marketplace = { contains: f.marketplace };
  if (f.type) where.transactionType = f.type;
  if (f.vendorId) where.vendorId = f.vendorId;
  if (f.fromDate || f.toDate) {
    const d: { gte?: Date; lte?: Date } = {};
    const from = f.fromDate ? parseFlexibleDate(f.fromDate) : null;
    const to = f.toDate ? parseFlexibleDate(f.toDate) : null;
    if (from) d.gte = from;
    if (to) d.lte = to;
    where.vchDate = d;
  }
  if (f.q) where.item = { OR: [{ skuCode: { contains: f.q } }, { name: { contains: f.q } }] };
  return where;
}

export async function emailFilteredSales(filters: Filters, to: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  if (!to.trim()) return { error: "Recipient email required" };
  const me = await getCurrentUser();

  const rows = await prisma.sale.findMany({
    where: buildWhere(filters),
    include: { item: { include: { vendor: { select: { name: true, code: true, model: true } } } } },
    orderBy: { vchDate: "desc" },
    take: 1000,
  });

  // Tiny CSV builder for the body — avoid pulling papaparse server-side here.
  const headers = ["Vch Date", "Marketplace", "SKU", "Vendor", "Model", "Type", "Sold", "Return", "RTO", "Net Sale", "Rate", "Amount", "GST Rate", "GST", "Amount+GST"];
  const csvEscape = (v: unknown) => {
    const s = String(sanitizeCell(v));
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(csvEscape).join(",")];
  for (const s of rows) {
    const netSale = s.qtySold - s.qtyReturn;
    const amount = netSale * s.unitRate;
    const gst = (amount * s.taxRate) / 100;
    lines.push([
      s.vchDate.toISOString().slice(0, 10),
      s.marketplace,
      s.item.skuCode,
      s.item.vendor.name,
      s.model ?? s.item.vendor.model ?? "",
      s.transactionType,
      s.qtySold, s.qtyReturn, s.qtyRTO,
      netSale.toFixed(2),
      s.unitRate.toFixed(2),
      amount.toFixed(2),
      s.taxRate.toFixed(2),
      gst.toFixed(2),
      (amount + gst).toFixed(2),
    ].map(csvEscape).join(","));
  }
  const csv = lines.join("\n");

  await sendEmail({
    to,
    cc: me?.email ?? undefined,
    subject: `Sales report — ${rows.length} rows`,
    text: `Attached: filtered sales report (${rows.length} rows).`,
    attachments: [{ filename: "sales.csv", content: Buffer.from(csv, "utf8"), contentType: "text/csv" }],
  });
  return { ok: true };
}
