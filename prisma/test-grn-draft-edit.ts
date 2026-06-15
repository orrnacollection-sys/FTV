/**
 * E2E test for updateGRNDraft: create a draft, edit it (header + items),
 * then promote (asDraft=false) and verify PO bump + status recompute.
 *
 *   npx tsx prisma/test-grn-draft-edit.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const summary: string[] = [];
let failures = 0;
const fail = (m: string) => { failures++; summary.push(`❌ ${m}`); };
const pass = (m: string) => summary.push(`✅ ${m}`);

// Mirror the updateGRNDraft logic from src/app/(admin)/grn/actions.ts.
// Auth wrappers stripped so we can run under node directly.
async function mirrorUpdateDraft(id: string, payload: {
  grnDate: Date;
  type: "PURCHASE" | "RTV" | "RFV";
  vendorId: string;
  warehouseId: string;
  vendorInvoiceNo: string | null;
  vendorInvoiceDate: Date | null;
  items: Array<{ itemId: string; poItemId?: string; qty: number; rejectedQty: number; rate: number; taxRate: number }>;
}, asDraft = true) {
  const existing = await prisma.gRN.findUniqueOrThrow({ where: { id }, include: { items: true } });
  if (!existing.isDraft) throw new Error("Not a draft");

  return await prisma.$transaction(async (tx) => {
    await tx.gRNItem.deleteMany({ where: { grnId: id } });
    let grnNo = existing.grnNo;
    let nextIsDraft = true;
    if (!asDraft) {
      // #134: Series is now (companyId, docType) — find first match for backwards compat.
      const series = await tx.series.findFirst({ where: { docType: "GRN" } });
      const next = (series?.nextNumber ?? 1);
      grnNo = `${series?.prefix ?? "GRN-"}${String(next).padStart(series?.padding ?? 4, "0")}`;
      if (series) await tx.series.update({ where: { id: series.id }, data: { nextNumber: next + 1 } });
      nextIsDraft = false;
    }
    const batchExp = new Date(payload.grnDate.getTime() + 120 * 86400000);
    let grandTotal = 0;
    const rows = payload.items.map((i, idx) => {
      const net = (i.qty - i.rejectedQty) * i.rate;
      const tax = (net * i.taxRate) / 100;
      const lineTotal = net + tax;
      grandTotal += lineTotal;
      return { ...i, taxableValue: net, tax, totalValue: lineTotal, batchNo: `${grnNo}-${idx + 1}`, batchExpDate: batchExp };
    });

    const poIdSet = new Set<string>();
    if (!nextIsDraft && payload.type === "PURCHASE") {
      for (const r of payload.items) {
        if (!r.poItemId) continue;
        const accepted = r.qty - r.rejectedQty;
        const poi = await tx.purchaseOrderItem.update({ where: { id: r.poItemId }, data: { receivedQty: { increment: accepted } }, select: { poId: true } });
        if (poi.poId) poIdSet.add(poi.poId);
      }
    }

    const itemRows = await Promise.all(rows.map(async (r) => {
      let poId: string | null = null;
      if (r.poItemId) {
        const poi = await tx.purchaseOrderItem.findUnique({ where: { id: r.poItemId }, select: { poId: true } });
        poId = poi?.poId ?? null;
      }
      return { ...r, poId };
    }));

    const grn = await tx.gRN.update({
      where: { id },
      data: {
        grnNo, isDraft: nextIsDraft,
        grnDate: payload.grnDate, type: payload.type, vendorId: payload.vendorId, warehouseId: payload.warehouseId,
        vendorInvoiceNo: payload.vendorInvoiceNo, vendorInvoiceDate: payload.vendorInvoiceDate,
        total: grandTotal,
        items: { create: itemRows.map((r) => ({
          itemId: r.itemId, poItemId: r.poItemId ?? null, poId: r.poId, qty: r.qty, rejectedQty: r.rejectedQty,
          rate: r.rate, taxRate: r.taxRate, taxableValue: r.taxableValue, tax: r.tax, totalValue: r.totalValue,
          batchNo: r.batchNo, batchExpDate: r.batchExpDate,
        })) },
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
  });
}

async function main() {
  const anok = await prisma.vendor.findFirstOrThrow({ where: { code: "ANOK" } });
  const anokItems = await prisma.item.findMany({ where: { vendorId: anok.id }, take: 3 });
  const wh = (await prisma.warehouse.findFirstOrThrow({ select: { id: true } })).id;

  // — SCENARIO 1: edit a draft GRN, stays a draft.
  const draft = await prisma.gRN.create({
    data: {
      grnNo: `DRAFT-${Date.now()}-1`,
      grnDate: new Date(), type: "PURCHASE", vendorId: anok.id, warehouseId: wh,
      isDraft: true, total: 0,
      items: { create: [{
        itemId: anokItems[0].id, qty: 5, rejectedQty: 0, rate: 100, taxRate: 12,
        taxableValue: 500, tax: 60, totalValue: 560, batchNo: "tmp-1", batchExpDate: new Date(),
      }] },
    },
  });
  await mirrorUpdateDraft(draft.id, {
    grnDate: new Date(), type: "PURCHASE", vendorId: anok.id, warehouseId: wh,
    vendorInvoiceNo: "INV-EDIT-1", vendorInvoiceDate: new Date(),
    items: [
      { itemId: anokItems[0].id, qty: 8, rejectedQty: 0, rate: 110, taxRate: 12 },
      { itemId: anokItems[1].id, qty: 3, rejectedQty: 0, rate: 200, taxRate: 12 },
    ],
  }, true);
  const after1 = await prisma.gRN.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true } });
  if (after1.items.length !== 2) fail(`draft edit: expected 2 items, got ${after1.items.length}`);
  else if (!after1.isDraft) fail(`draft edit: should still be a draft`);
  else if (after1.vendorInvoiceNo !== "INV-EDIT-1") fail(`draft edit: invoice no didn't update`);
  else pass(`draft edit: 1 line → 2 lines, header updated, still a draft`);
  await prisma.gRN.delete({ where: { id: draft.id } });

  // — SCENARIO 2: edit a draft AND promote in one save.
  // Pick a real open PO line so the bump can be verified.
  const openLine = await prisma.purchaseOrderItem.findFirst({
    where: { po: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] }, vendorId: anok.id } },
    include: { po: true },
  });
  const draft2 = await prisma.gRN.create({
    data: {
      grnNo: `DRAFT-${Date.now()}-2`,
      grnDate: new Date(), type: "PURCHASE", vendorId: anok.id, warehouseId: wh,
      isDraft: true, total: 0,
      items: { create: [{
        itemId: anokItems[0].id, qty: 1, rejectedQty: 0, rate: 100, taxRate: 12,
        taxableValue: 100, tax: 12, totalValue: 112, batchNo: "tmp-2", batchExpDate: new Date(),
      }] },
    },
  });
  const beforePoBump = openLine ? openLine.receivedQty : 0;
  await mirrorUpdateDraft(draft2.id, {
    grnDate: new Date(), type: "PURCHASE", vendorId: anok.id, warehouseId: wh,
    vendorInvoiceNo: null, vendorInvoiceDate: null,
    items: openLine
      ? [{ itemId: openLine.itemId, poItemId: openLine.id, qty: 2, rejectedQty: 0, rate: openLine.rate, taxRate: openLine.taxRate }]
      : [{ itemId: anokItems[0].id, qty: 2, rejectedQty: 0, rate: 100, taxRate: 12 }],
  }, false /* promote */);
  const after2 = await prisma.gRN.findUniqueOrThrow({ where: { id: draft2.id }, include: { items: true } });
  if (after2.isDraft) fail(`promote: should no longer be a draft`);
  else if (!/^GRN-/.test(after2.grnNo)) fail(`promote: grnNo should have series prefix, got "${after2.grnNo}"`);
  else if (openLine) {
    const lineAfter = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: openLine.id } });
    if (lineAfter.receivedQty !== beforePoBump + 2) fail(`promote: PO receivedQty didn't bump (${beforePoBump} → ${lineAfter.receivedQty})`);
    else pass(`promote: grnNo=${after2.grnNo}, PO receivedQty ${beforePoBump} → ${lineAfter.receivedQty}`);
  } else {
    pass(`promote: grnNo=${after2.grnNo} (no PO to bump)`);
  }
  // Cleanup: delete the GRN + rollback PO bump.
  await prisma.gRN.delete({ where: { id: draft2.id } });
  if (openLine) {
    await prisma.purchaseOrderItem.update({ where: { id: openLine.id }, data: { receivedQty: beforePoBump } });
    await prisma.purchaseOrder.update({ where: { id: openLine.poId }, data: { status: openLine.po.status } });
  }

  // — SCENARIO 3: refuse to edit a POSTED GRN.
  const posted = await prisma.gRN.findFirst({ where: { isDraft: false } });
  if (posted) {
    try {
      await mirrorUpdateDraft(posted.id, {
        grnDate: new Date(), type: "PURCHASE", vendorId: anok.id, warehouseId: wh,
        vendorInvoiceNo: null, vendorInvoiceDate: null,
        items: [{ itemId: anokItems[0].id, qty: 1, rejectedQty: 0, rate: 100, taxRate: 12 }],
      });
      fail("posted GRN edit was accepted — should refuse");
    } catch (e) {
      if (e instanceof Error && /draft/i.test(e.message)) pass(`posted GRN edit correctly refused: "${e.message}"`);
      else fail(`posted GRN edit threw wrong error: ${e}`);
    }
  } else {
    summary.push("⚠️ no posted GRN in demo — skipped scenario 3");
  }

  console.log("\n=== updateGRNDraft TEST SUMMARY ===");
  for (const s of summary) console.log("  " + s);
  console.log(failures === 0 ? "\nAll scenarios passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
