"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEditor, getCurrentUser } from "@/lib/rbac";
import { poSchema } from "@/lib/validators/po";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderPoPdf } from "@/lib/pdf-po";
import { getActiveCompany, getActiveCompanyId } from "@/lib/company";
import { env } from "@/lib/env";

type Result =
  | { ok: true; id: string; poNumber: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

export async function createPO(payload: unknown, asDraft = false): Promise<Result> {
  const me = await requireEditor();
  const parsed = poSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const poDate = parseFlexibleDate(parsed.data.poDate);
  if (!poDate) return { error: "Invalid PO date" };
  const dueDate = parsed.data.dueDate ? parseFlexibleDate(parsed.data.dueDate) : null;
  const companyId = await getActiveCompanyId();

  // Pooled SKUs (Option B): any item can be ordered from any vendor — only
  // verify the items exist in this company.
  const items = await prisma.item.findMany({
    where: { companyId, id: { in: parsed.data.items.map((i) => i.itemId) } },
    select: { id: true },
  });
  if (items.length !== parsed.data.items.length) {
    return { error: "One or more items don't exist" };
  }

  let createdId = "";
  let poNumber = "";
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Drafts use a temp poNumber so the @unique constraint is happy without
      // burning a real series number. Promotion swaps it for nextDocNumber("PO").
      const poNo = asDraft ? `DRAFT-${crypto.randomUUID()}` : await nextDocNumber("PO", tx);
      let subtotal = 0;
      let taxSum = 0;
      const rows = parsed.data.items.map((i) => {
        const lineNet = i.qty * i.rate;
        const lineTax = (lineNet * i.taxRate) / 100;
        subtotal += lineNet;
        taxSum += lineTax;
        return {
          itemId: i.itemId,
          qty: i.qty,
          rate: i.rate,
          taxRate: i.taxRate,
          total: lineNet + lineTax,
        };
      });
      const po = await tx.purchaseOrder.create({
        data: {
          companyId,
          poNumber: poNo,
          vendorId: parsed.data.vendorId,
          poDate,
          dueDate,
          notes: parsed.data.notes ?? null,
          total: subtotal + taxSum,
          status: "OPEN",
          isDraft: asDraft,
          createdBy: me.id,
          items: { create: rows },
        },
      });
      return po;
    });
    createdId = result.id;
    poNumber = result.poNumber;
  } catch {
    return { error: asDraft ? "Failed to save draft" : "Failed to create PO" };
  }
  await logWrite("PurchaseOrder", createdId, "CREATE", null, { poNumber, vendorId: parsed.data.vendorId, isDraft: asDraft });
  revalidatePath("/purchase-orders");
  return { ok: true, id: createdId, poNumber };
}

/**
 * Edit an existing PO.
 *
 *  • DRAFT: anything is editable. We wipe items and reinsert from the payload
 *    — no receivedQty side-effects to worry about since drafts haven't bumped
 *    any GRN lines.
 *  • POSTED: header fields (poDate, dueDate, notes) are editable. Items have
 *    line-level rules:
 *      - The vendor is FROZEN — you can't repurpose a posted PO for a
 *        different supplier. (Delete + recreate if that's what you need.)
 *      - A line with receivedQty > 0 is "received-locked":
 *          itemId / rate / taxRate cannot change;
 *          qty cannot drop below receivedQty.
 *      - A line with receivedQty = 0 can be edited freely, removed, or
 *        replaced with a different SKU.
 *      - New lines can always be added.
 *    The PO status is recomputed from the post-edit qty vs receivedQty.
 */
export async function updatePO(
  id: string,
  payload: unknown,
  asDraft = false,
): Promise<Result> {
  await requireEditor();
  const parsed = poSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return { error: "PO not found" };
  if (existing.status === "CANCELLED") return { error: "Cancelled POs can't be edited" };

  const poDate = parseFlexibleDate(parsed.data.poDate);
  if (!poDate) return { error: "Invalid PO date" };
  const dueDate = parsed.data.dueDate ? parseFlexibleDate(parsed.data.dueDate) : null;

  // Verify every payload item exists in the PO's company. Pulling companyId from
  // the existing PO so a multi-company user editing under a different active
  // cookie still scopes correctly. Pooled SKUs (Option B): items may come from
  // any vendor, so we no longer check item.vendorId against the PO vendor.
  const itemMaster = await prisma.item.findMany({
    where: { companyId: existing.companyId ?? undefined, id: { in: parsed.data.items.map((i) => i.itemId) } },
    select: { id: true },
  });
  if (itemMaster.length !== parsed.data.items.length) {
    return { error: "One or more items don't exist" };
  }
  // Posted PO: the vendor is frozen (drafts may still switch vendor).
  if (!existing.isDraft && parsed.data.vendorId !== existing.vendorId) {
    return { error: "Vendor can't be changed on a posted PO" };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      let taxSum = 0;
      const payloadRows = parsed.data.items.map((i) => {
        const lineNet = i.qty * i.rate;
        const lineTax = (lineNet * i.taxRate) / 100;
        subtotal += lineNet;
        taxSum += lineTax;
        return {
          poItemId: i.poItemId ?? null,
          itemId: i.itemId,
          qty: i.qty,
          rate: i.rate,
          taxRate: i.taxRate,
          total: lineNet + lineTax,
        };
      });

      if (existing.isDraft) {
        // Draft: simplest path — wipe & reinsert. No GRN/stock cascade exists yet.
        await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
        await tx.purchaseOrderItem.createMany({
          data: payloadRows.map((r) => ({
            poId: id, itemId: r.itemId, qty: r.qty, rate: r.rate, taxRate: r.taxRate, total: r.total,
          })),
        });
      } else {
        // Posted PO: enforce the per-line received-lock + sync the row set.
        const existingById = new Map(existing.items.map((it) => [it.id, it] as const));
        const keepIds = new Set<string>();
        for (const row of payloadRows) {
          if (row.poItemId && existingById.has(row.poItemId)) {
            keepIds.add(row.poItemId);
            const prev = existingById.get(row.poItemId)!;
            if (prev.receivedQty > 0) {
              // Received-locked. itemId, rate, taxRate frozen; qty floor = receivedQty.
              if (prev.itemId !== row.itemId) {
                throw new Error(`SKU on a received line can't change (line received ${prev.receivedQty})`);
              }
              if (Math.abs(prev.rate - row.rate) > 0.001 || Math.abs(prev.taxRate - row.taxRate) > 0.001) {
                throw new Error(`Rate / GST on a received line can't change`);
              }
              if (row.qty < prev.receivedQty) {
                throw new Error(`Qty can't drop below received (${prev.receivedQty})`);
              }
            }
            await tx.purchaseOrderItem.update({
              where: { id: row.poItemId },
              data: {
                itemId: row.itemId,
                qty: row.qty,
                rate: row.rate,
                taxRate: row.taxRate,
                total: row.total,
              },
            });
          } else {
            // New line on a posted PO — always allowed.
            await tx.purchaseOrderItem.create({
              data: {
                poId: id,
                itemId: row.itemId,
                qty: row.qty,
                rate: row.rate,
                taxRate: row.taxRate,
                total: row.total,
              },
            });
          }
        }
        // Lines the user dropped from the payload. Allowed only if untouched.
        for (const prev of existing.items) {
          if (keepIds.has(prev.id)) continue;
          if (prev.receivedQty > 0) {
            throw new Error(`A received line was removed from the payload — refusing`);
          }
          await tx.purchaseOrderItem.delete({ where: { id: prev.id } });
        }
      }

      // Recompute status from new qty vs receivedQty (drafts stay OPEN).
      let status = existing.status;
      if (!existing.isDraft) {
        const rows = await tx.purchaseOrderItem.findMany({
          where: { poId: id }, select: { qty: true, receivedQty: true },
        });
        const totalQ = rows.reduce((s, r) => s + r.qty, 0);
        const recQ = rows.reduce((s, r) => s + r.receivedQty, 0);
        status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
      }

      // Drafts can also be promoted as part of an edit — keep the existing
      // semantics: a draft can save again as a draft (asDraft=true) or be
      // promoted to a real PO (asDraft=false), which allocates a doc number.
      let newPoNumber = existing.poNumber;
      let nextIsDraft = existing.isDraft;
      if (existing.isDraft && !asDraft) {
        newPoNumber = await nextDocNumber("PO", tx);
        nextIsDraft = false;
      }

      return await tx.purchaseOrder.update({
        where: { id },
        data: {
          poNumber: newPoNumber,
          isDraft: nextIsDraft,
          poDate,
          dueDate,
          notes: parsed.data.notes ?? null,
          total: subtotal + taxSum,
          status,
        },
      });
    });

    await logWrite("PurchaseOrder", id, "UPDATE",
      { isDraft: existing.isDraft, status: existing.status, total: existing.total, poDate: existing.poDate, dueDate: existing.dueDate, notes: existing.notes },
      { isDraft: updated.isDraft, status: updated.status, total: updated.total, poDate: updated.poDate, dueDate: updated.dueDate, notes: updated.notes, items: parsed.data.items.length },
    );
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return { ok: true, id: updated.id, poNumber: updated.poNumber };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update PO" };
  }
}

/** Promote a draft PO: re-validate, allocate the real PO number, flip isDraft. */
export async function promoteDraftPO(id: string): Promise<Result> {
  await requireEditor();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!draft) throw new Error("Draft not found");
      if (!draft.isDraft) throw new Error("Already promoted");
      const poNo = await nextDocNumber("PO", tx);
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { poNumber: poNo, isDraft: false },
      });
      return updated;
    });
    await logWrite("PurchaseOrder", id, "UPDATE", { isDraft: true }, { isDraft: false, poNumber: result.poNumber });
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return { ok: true, id: result.id, poNumber: result.poNumber };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to promote draft" };
  }
}

export async function closePO(id: string): Promise<{ ok: true } | { error: string }> {
  await requireEditor();
  try {
    const before = await prisma.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
    if (!before) return { error: "PO not found" };
    if (before.status === "CLOSED") return { error: "Already closed" };
    await prisma.purchaseOrder.update({ where: { id }, data: { status: "CLOSED" } });
    await logWrite("PurchaseOrder", id, "UPDATE", before, { status: "CLOSED" });
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return { ok: true };
  } catch {
    return { error: "Failed to close PO" };
  }
}

export async function deletePO(id: string): Promise<{ ok: true } | { error: string }> {
  await requireEditor();
  const before = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!before) return { error: "PO not found" };
  // Block delete if any GRN has consumed an item from this PO.
  const hasReceipts = await prisma.gRNItem.findFirst({ where: { poId: id }, select: { id: true } });
  if (hasReceipts) return { error: "PO has receipts — close it instead" };
  await prisma.purchaseOrder.delete({ where: { id } });
  await logWrite("PurchaseOrder", id, "DELETE", before, null);
  revalidatePath("/purchase-orders");
  return { ok: true };
}

/** Render a fresh PDF and return its bytes. Used by the view page + email path. */
export async function buildPdf(id: string): Promise<Buffer | null> {
  await requireAdmin();
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      items: { include: { item: { include: { vendor: { select: { model: true } }, priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } } } } } },
    },
  });
  if (!po) return null;
  let subtotal = 0;
  let taxTotal = 0;
  const items = po.items.map((i) => {
    const net = i.qty * i.rate;
    const tax = (net * i.taxRate) / 100;
    subtotal += net;
    taxTotal += tax;
    // Only embed images served from our own origins. Blocks SSRF via a maliciously
    // edited Item.imageUrl pointing at internal addresses.
    const raw = i.item.imageUrl ?? "";
    let url: string | null = null;
    if (raw.startsWith("/uploads/")) {
      url = `${env.NEXT_PUBLIC_APP_URL}${raw}`;
    } else if (/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(raw)) {
      url = raw;
    } else if (raw.startsWith(env.NEXT_PUBLIC_APP_URL + "/")) {
      url = raw;
    }
    return {
      skuCode: i.item.skuCode,
      name: i.item.name,
      hsn: i.item.hsn,
      model: i.item.priceRevisions[0]?.model ?? i.item.vendor.model ?? "",
      qty: i.qty,
      rate: i.rate,
      taxRate: i.taxRate,
      total: net + tax,
      imageUrl: url,
    };
  });
  const company = await getActiveCompany();
  return await renderPoPdf({
    poNumber: po.poNumber,
    poDate: po.poDate,
    dueDate: po.dueDate,
    notes: po.notes,
    org: {
      name: company.brandName,
      legalName: company.legalName,
      addressLine: company.addressLine,
      gst: company.defaultGstin?.gstin ?? null,
    },
    vendor: {
      code: po.vendor.code ?? "",
      name: po.vendor.name,
      address: po.vendor.address,
      city: po.vendor.city,
      state: po.vendor.state,
      pincode: po.vendor.pincode,
      gst: po.vendor.gst,
    },
    items,
    subtotal,
    taxTotal,
    grandTotal: subtotal + taxTotal,
  });
}

export async function emailPO(id: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { vendor: { select: { name: true, email: true } } },
  });
  if (!po) return { error: "PO not found" };
  if (!po.vendor.email) return { error: "Vendor has no email on file" };
  const pdf = await buildPdf(id);
  if (!pdf) return { error: "Failed to render PDF" };
  const me = await getCurrentUser();
  try {
    await sendEmail({
      to: po.vendor.email,
      cc: me?.email ?? undefined,
      subject: `Purchase Order ${po.poNumber}`,
      text: `Hello ${po.vendor.name},\n\nPlease find attached our purchase order ${po.poNumber}.\n\n— Adwitiya Global`,
      attachments: [{ filename: `${po.poNumber}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch {
    return { error: "Email failed (see server logs)" };
  }
  await logWrite("PurchaseOrder", id, "UPDATE", null, { emailedAt: new Date().toISOString() });
  return { ok: true };
}
