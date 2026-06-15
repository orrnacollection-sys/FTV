"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { itemSchema, priceRevisionSchema, type ItemInput } from "@/lib/validators/item";
import { Prisma } from "@prisma/client";
import { parseFlexibleDate } from "@/lib/date";
import { saveUpload } from "@/lib/uploads";
import { requireEditor } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { isValidModel } from "@/lib/models";
import { getOnHandQty } from "@/lib/stock";
import { getActiveCompanyId } from "@/lib/company";

const MAX_IMPORT_ROWS = 10000;
/** Rows written per batch. Big enough to slash round-trips, small enough to
 *  stay well under SQLite/Postgres bind-parameter limits. */
const IMPORT_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function rawFromForm(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") o[k] = v;
  }
  return o;
}

async function handleImage(fd: FormData, existing?: string | null): Promise<string | undefined> {
  const f = fd.get("image") as File | null;
  if (!f || typeof f === "string" || f.size === 0) return existing ?? undefined;
  return await saveUpload("items", f);
}

export async function createItem(fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = itemSchema.safeParse(rawFromForm(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const date = parseFlexibleDate(parsed.data.effectiveDate);
  if (!date) {
    return { ok: false, error: "Invalid effective date", fieldErrors: { effectiveDate: "Use DD-MM-YYYY or YYYY-MM-DD" } };
  }
  if (!(await isValidModel(parsed.data.model))) {
    return { ok: false, error: "Unknown model", fieldErrors: { model: "Pick a valid model" } };
  }

  let imageUrl: string | undefined;
  try {
    imageUrl = await handleImage(fd);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Image upload failed" };
  }

  let createdId: string | null = null;
  try {
    const companyId = await getActiveCompanyId();
    const created = await prisma.item.create({
      data: {
        skuCode: parsed.data.skuCode,
        name: parsed.data.name,
        hsn: parsed.data.hsn,
        categoryId: parsed.data.categoryId || null,
        vendorId: parsed.data.vendorId,
        vendorSku: parsed.data.vendorSku,
        itemType: parsed.data.itemType,
        imageUrl,
        companyId,
        priceRevisions: {
          create: {
            transferPrice: parsed.data.transferPrice,
            taxRate: parsed.data.taxRate,
            model: parsed.data.model,
            effectiveDate: date,
          },
        },
      },
    });
    createdId = created.id;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "SKU code already exists" };
    }
    return { ok: false, error: "Failed to create item" };
  }
  if (createdId) await logWrite("Item", createdId, "CREATE", null, parsed.data);
  revalidatePath("/items");
  redirect("/items");
}

export async function updateItem(id: string, fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = itemSchema.safeParse(rawFromForm(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const date = parseFlexibleDate(parsed.data.effectiveDate);
  if (!date) {
    return { ok: false, error: "Invalid effective date", fieldErrors: { effectiveDate: "Use DD-MM-YYYY or YYYY-MM-DD" } };
  }

  if (!(await isValidModel(parsed.data.model))) {
    return { ok: false, error: "Unknown model", fieldErrors: { model: "Pick a valid model" } };
  }

  const existing = await prisma.item.findUnique({
    where: { id },
    include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  if (!existing) return { ok: false, error: "Item not found" };

  // Block a model change while stock is on hand (commingled FTV/OR mis-settlement guard).
  const latest = existing.priceRevisions[0];
  if (latest?.model && latest.model !== parsed.data.model) {
    const onHand = await getOnHandQty(id);
    if (onHand !== 0) {
      return { ok: false, error: `Can't change model while ${onHand} unit(s) are in stock — clear stock first`, fieldErrors: { model: "Stock must be 0 to switch model" } };
    }
  }

  let imageUrl: string | undefined;
  try {
    imageUrl = await handleImage(fd, existing.imageUrl);
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Image upload failed" };
  }

  const priceChanged =
    !latest ||
    latest.transferPrice !== parsed.data.transferPrice ||
    latest.taxRate !== parsed.data.taxRate ||
    latest.model !== parsed.data.model ||
    latest.effectiveDate.getTime() !== date.getTime();

  try {
    await prisma.item.update({
      where: { id },
      data: {
        skuCode: parsed.data.skuCode,
        name: parsed.data.name,
        hsn: parsed.data.hsn,
        categoryId: parsed.data.categoryId || null,
        vendorId: parsed.data.vendorId,
        vendorSku: parsed.data.vendorSku,
        itemType: parsed.data.itemType,
        imageUrl,
        ...(priceChanged
          ? {
              priceRevisions: {
                create: {
                  transferPrice: parsed.data.transferPrice,
                  taxRate: parsed.data.taxRate,
                  model: parsed.data.model,
                  effectiveDate: date,
                },
              },
            }
          : {}),
      },
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "SKU code already exists" };
    }
    return { ok: false, error: "Failed to update item" };
  }
  await logWrite("Item", id, "UPDATE", { id }, parsed.data);
  revalidatePath("/items");
  redirect("/items");
}

// ── Standalone price update — appends a revision, keeps history ──────────────

export async function addPriceRevision(
  fd: FormData,
): Promise<{ ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> }> {
  await requireEditor();
  const itemId = String(fd.get("itemId") ?? "");
  if (!itemId) return { error: "Item not specified" };

  const parsed = priceRevisionSchema.safeParse({
    model: String(fd.get("model") ?? ""),
    transferPrice: String(fd.get("transferPrice") ?? ""),
    taxRate: String(fd.get("taxRate") ?? ""),
    effectiveDate: String(fd.get("effectiveDate") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const date = parseFlexibleDate(parsed.data.effectiveDate);
  if (!date) return { error: "Invalid date", fieldErrors: { effectiveDate: "Use a valid date" } };
  if (!(await isValidModel(parsed.data.model))) {
    return { error: "Unknown model", fieldErrors: { model: "Pick a valid model" } };
  }

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  if (!item) return { error: "Item not found" };

  // Block a model change while stock is on hand.
  const latest = item.priceRevisions[0];
  if (latest?.model && latest.model !== parsed.data.model) {
    const onHand = await getOnHandQty(itemId);
    if (onHand !== 0) {
      return { error: `Can't change model while ${onHand} unit(s) are in stock — clear stock first`, fieldErrors: { model: "Stock must be 0 to switch model" } };
    }
  }

  await prisma.itemPriceRevision.create({
    data: { itemId, transferPrice: parsed.data.transferPrice, taxRate: parsed.data.taxRate, model: parsed.data.model, effectiveDate: date },
  });
  await logWrite(
    "Item",
    itemId,
    "UPDATE",
    { latestPrice: item.priceRevisions[0] ?? null },
    { newPrice: { transferPrice: parsed.data.transferPrice, taxRate: parsed.data.taxRate, model: parsed.data.model, effectiveDate: date } },
  );
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return { ok: true };
}

// ── Bulk CSV import — upsert by skuCode, append price revision on change ──────

type ImportResult = {
  created: number;
  updated: number;
  errors: string[];
  // Per-row failures echoed back with the original columns + an Error column,
  // so the client can offer a "download error report" CSV to fix & re-upload.
  errorRows?: Record<string, string>[];
  needsConfirm?: boolean;
  overwriteCount?: number;
};

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export async function bulkImportItems(rows: Record<string, string>[], confirmOverwrite = false): Promise<ImportResult> {
  await requireEditor();
  if (rows.length === 0) return { created: 0, updated: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { created: 0, updated: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  // Overwrite guard: how many incoming SKUs already exist (would be updated)?
  const incomingSkus = [...new Set(rows.map((r) => pick(r, "skuCode", "SKU Code", "SKU", "sku").trim()).filter(Boolean))];
  const overwriteCount = incomingSkus.length
    ? await prisma.item.count({ where: { companyId, skuCode: { in: incomingSkus } } })
    : 0;
  if (overwriteCount > 0 && !confirmOverwrite) {
    return { created: 0, updated: 0, errors: [], needsConfirm: true, overwriteCount };
  }

  const [vendors, categories] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, code: true, name: true, model: true } }),
    prisma.category.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const cByName = new Map(categories.map((c) => [c.name.trim().toUpperCase(), c.id]));

  // Pre-load once instead of per-row (a 5k import otherwise fires ~20k queries:
  // 2 model-count + 1 findUnique per row). Valid model codes + existing items
  // (with their latest revision) keyed by SKU.
  const validModels = new Set(
    (await prisma.modelMaster.findMany({ where: { isActive: true }, select: { code: true } })).map((m) => m.code.toUpperCase()),
  );
  const existingItems = await prisma.item.findMany({
    where: { companyId, skuCode: { in: incomingSkus } },
    include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  const existingBySku = new Map(existingItems.map((it) => [it.skuCode, it]));

  const errors: string[] = [];
  const errorRows: Record<string, string>[] = [];
  const fail = (rowNum: number, src: Record<string, string>, msg: string) => {
    errors.push(`Row ${rowNum}: ${msg}`);
    errorRows.push({ Row: String(rowNum), ...src, Error: msg });
  };

  // ── Phase 1: validate every row in memory (no DB writes) ──────────────────
  // Last valid occurrence per SKU wins, matching the old row-by-row behaviour
  // where a later duplicate updated the just-created row.
  type Revision = { transferPrice: number; taxRate: number; model: string; effectiveDate: Date };
  type Resolved = { rowNum: number; raw: Record<string, string>; data: ItemInput; date: Date };
  const resolved = new Map<string, Resolved>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    // Skip fully-blank rows (trailing CSV padding) — not real mismatches.
    if (Object.values(r).every((v) => !v || !v.trim())) continue;

    const skuCode = pick(r, "skuCode", "SKU Code", "SKU", "sku").trim();
    if (!skuCode) { fail(rowNum, r, "skuCode required"); continue; }

    const vendorRaw = pick(r, "vendorCode", "Vendor Code", "vendor", "Vendor", "vendorName", "Vendor Name").trim();
    const vendor = vByCode.get(vendorRaw.toUpperCase()) ?? vByName.get(vendorRaw.toUpperCase());
    if (!vendor) { fail(rowNum, r, `vendor "${vendorRaw || "?"}" not found`); continue; }

    const catRaw = pick(r, "category", "Category").trim();
    let categoryId = "";
    if (catRaw) {
      const id = cByName.get(catRaw.toUpperCase());
      if (!id) { fail(rowNum, r, `category "${catRaw}" not found`); continue; }
      categoryId = id;
    }

    // Model from the row's column, else fall back to the vendor's current model.
    const modelRaw = pick(r, "model", "Model").toUpperCase().trim().replace(/-/g, "_");
    const model = modelRaw || (vendor.model ?? "");

    const data = {
      skuCode,
      name: pick(r, "name", "Name", "Item Name").trim(),
      hsn: pick(r, "hsn", "HSN"),
      categoryId,
      vendorId: vendor.id,
      vendorSku: pick(r, "vendorSku", "Vendor SKU", "Vendor Sku"),
      model,
      transferPrice: pick(r, "transferPrice", "Transfer Price", "Rate", "rate", "price", "Price"),
      taxRate: pick(r, "taxRate", "Tax Rate", "Tax", "tax", "GST", "gst", "GST %"),
      effectiveDate: pick(r, "effectiveDate", "Effective Date", "Date", "date"),
    };
    const parsed = itemSchema.safeParse(data);
    if (!parsed.success) {
      fail(rowNum, r, parsed.error.issues.map((x) => x.message).join("; "));
      continue;
    }
    if (!validModels.has(parsed.data.model.trim().toUpperCase())) {
      fail(rowNum, r, `unknown model "${parsed.data.model}"`);
      continue;
    }
    const date = parseFlexibleDate(parsed.data.effectiveDate);
    if (!date) { fail(rowNum, r, `invalid date "${parsed.data.effectiveDate}"`); continue; }

    resolved.set(parsed.data.skuCode, { rowNum, raw: r, data: parsed.data, date });
  }

  // ── Phase 2: split into inserts vs updates ────────────────────────────────
  type Create = { rowNum: number; raw: Record<string, string>; item: Prisma.ItemCreateManyInput; rev: Revision };
  type Update = { rowNum: number; raw: Record<string, string>; id: string; data: Prisma.ItemUncheckedUpdateInput };
  const creates: Create[] = [];
  const updates: Update[] = [];

  for (const res of resolved.values()) {
    const d = res.data;
    const rev: Revision = { transferPrice: d.transferPrice, taxRate: d.taxRate, model: d.model, effectiveDate: res.date };
    const existing = existingBySku.get(d.skuCode);
    if (!existing) {
      creates.push({
        rowNum: res.rowNum,
        raw: res.raw,
        item: { skuCode: d.skuCode, name: d.name, hsn: d.hsn, categoryId: d.categoryId || null, vendorId: d.vendorId, vendorSku: d.vendorSku, companyId },
        rev,
      });
      continue;
    }
    const latest = existing.priceRevisions[0];
    // Block model switch while stock is on hand (only checked when it changes).
    if (latest?.model && latest.model !== d.model) {
      const onHand = await getOnHandQty(existing.id);
      if (onHand !== 0) { fail(res.rowNum, res.raw, `can't switch model while ${onHand} unit(s) in stock`); continue; }
    }
    const priceChanged =
      !latest ||
      latest.transferPrice !== d.transferPrice ||
      latest.taxRate !== d.taxRate ||
      latest.model !== d.model ||
      latest.effectiveDate.getTime() !== res.date.getTime();
    updates.push({
      rowNum: res.rowNum,
      raw: res.raw,
      id: existing.id,
      data: {
        name: d.name,
        hsn: d.hsn,
        categoryId: d.categoryId || null,
        vendorId: d.vendorId,
        vendorSku: d.vendorSku,
        ...(priceChanged ? { priceRevisions: { create: rev } } : {}),
      },
    });
  }

  // ── Phase 3: batched writes ───────────────────────────────────────────────
  let created = 0;
  let updated = 0;

  // Inserts: per chunk, createMany the items, read their ids back, then
  // createMany the price revisions — all inside one transaction so a failure
  // rolls the chunk back cleanly and we can isolate the offending row.
  for (const part of chunk(creates, IMPORT_CHUNK)) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.item.createMany({ data: part.map((c) => c.item) });
        const made = await tx.item.findMany({
          where: { skuCode: { in: part.map((c) => c.item.skuCode) } },
          select: { id: true, skuCode: true },
        });
        const idBySku = new Map(made.map((m) => [m.skuCode, m.id]));
        await tx.itemPriceRevision.createMany({
          data: part.map((c) => ({ itemId: idBySku.get(c.item.skuCode)!, ...c.rev })),
        });
      }, { timeout: 120_000, maxWait: 20_000 });
      created += part.length;
    } catch {
      // Fall back to per-row so one bad SKU doesn't sink the whole chunk.
      for (const c of part) {
        try {
          await prisma.item.create({ data: { ...c.item, priceRevisions: { create: c.rev } } });
          created++;
        } catch (e: unknown) {
          if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
            fail(c.rowNum, c.raw, `SKU "${c.item.skuCode}" duplicate`);
          } else {
            fail(c.rowNum, c.raw, "save failed");
          }
        }
      }
    }
  }

  // Updates: each row may set different fields, so batch them in one
  // transaction per chunk (single commit), with a per-row fallback.
  for (const part of chunk(updates, IMPORT_CHUNK)) {
    try {
      await prisma.$transaction(
        part.map((u) => prisma.item.update({ where: { id: u.id }, data: u.data })),
      );
      updated += part.length;
    } catch {
      for (const u of part) {
        try { await prisma.item.update({ where: { id: u.id }, data: u.data }); updated++; }
        catch { fail(u.rowNum, u.raw, "save failed"); }
      }
    }
  }

  if (created + updated > 0) await logWrite("Item", "bulk", "CREATE", null, { created, updated });
  revalidatePath("/items");
  return { created, updated, errors, errorRows };
}

export async function deleteItem(id: string): Promise<void> {
  await requireEditor();
  const before = await prisma.item.findUnique({ where: { id } });
  await prisma.item.delete({ where: { id } });
  if (before) await logWrite("Item", id, "DELETE", before, null);
  revalidatePath("/items");
}

export async function quickCreateCategory(name: string, parentId?: string): Promise<{ id: string; name: string } | { error: string }> {
  await requireEditor();
  const n = name.trim();
  if (!n) return { error: "Name required" };
  try {
    const c = await prisma.category.create({
      data: { name: n, parentId: parentId || null },
    });
    revalidatePath("/items");
    revalidatePath("/categories");
    return { id: c.id, name: c.name };
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "Category already exists at this level" };
    }
    return { error: "Failed to create category" };
  }
}
