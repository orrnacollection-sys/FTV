/**
 * End-to-end test for updatePO: draft full edit, posted partial edit with the
 * received-line lock, status recompute. Mirrors the server action's logic
 * directly so we can run outside an HTTP request.
 *
 *   npx tsx prisma/test-po-edit.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const summary: string[] = [];
let failures = 0;
const fail = (m: string) => { failures++; summary.push(`❌ ${m}`); };
const pass = (m: string) => summary.push(`✅ ${m}`);

async function mirrorUpdatePO(id: string, payload: {
  vendorId: string;
  poDate: Date;
  dueDate: Date | null;
  notes: string | null;
  items: Array<{ poItemId?: string; itemId: string; qty: number; rate: number; taxRate: number }>;
}) {
  const existing = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
  await prisma.$transaction(async (tx) => {
    let subtotal = 0, taxSum = 0;
    const rows = payload.items.map((i) => {
      const net = i.qty * i.rate;
      const tax = (net * i.taxRate) / 100;
      subtotal += net; taxSum += tax;
      return { ...i, total: net + tax };
    });
    if (existing.isDraft) {
      await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
      await tx.purchaseOrderItem.createMany({
        data: rows.map((r) => ({ poId: id, itemId: r.itemId, qty: r.qty, rate: r.rate, taxRate: r.taxRate, total: r.total })),
      });
    } else {
      const existingById = new Map(existing.items.map((it) => [it.id, it] as const));
      const keepIds = new Set<string>();
      for (const r of rows) {
        if (r.poItemId && existingById.has(r.poItemId)) {
          keepIds.add(r.poItemId);
          const prev = existingById.get(r.poItemId)!;
          if (prev.receivedQty > 0) {
            if (prev.itemId !== r.itemId) throw new Error(`SKU on a received line can't change`);
            if (Math.abs(prev.rate - r.rate) > 0.001 || Math.abs(prev.taxRate - r.taxRate) > 0.001) throw new Error(`Rate/GST locked`);
            if (r.qty < prev.receivedQty) throw new Error(`Qty < received (${prev.receivedQty})`);
          }
          await tx.purchaseOrderItem.update({ where: { id: r.poItemId }, data: { itemId: r.itemId, qty: r.qty, rate: r.rate, taxRate: r.taxRate, total: r.total } });
        } else {
          await tx.purchaseOrderItem.create({ data: { poId: id, itemId: r.itemId, qty: r.qty, rate: r.rate, taxRate: r.taxRate, total: r.total } });
        }
      }
      for (const prev of existing.items) {
        if (!keepIds.has(prev.id)) {
          if (prev.receivedQty > 0) throw new Error(`Removed received line`);
          await tx.purchaseOrderItem.delete({ where: { id: prev.id } });
        }
      }
    }
    let status = existing.status;
    if (!existing.isDraft) {
      const items = await tx.purchaseOrderItem.findMany({ where: { poId: id }, select: { qty: true, receivedQty: true } });
      const totalQ = items.reduce((s, x) => s + x.qty, 0);
      const recQ = items.reduce((s, x) => s + x.receivedQty, 0);
      status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
    }
    await tx.purchaseOrder.update({ where: { id }, data: { poDate: payload.poDate, dueDate: payload.dueDate, notes: payload.notes, total: subtotal + taxSum, status } });
  });
}

async function main() {
  const anok = await prisma.vendor.findFirstOrThrow({ where: { code: "ANOK" } });
  const anokItems = await prisma.item.findMany({ where: { vendorId: anok.id }, take: 3 });
  if (anokItems.length < 3) { fail("need ≥3 ANOK items in demo"); return done(); }

  // — SCENARIO 1: DRAFT EDIT — full rewrite is allowed.
  const draft = await prisma.purchaseOrder.create({
    data: {
      poNumber: `DRAFT-${Date.now()}`,
      vendorId: anok.id, poDate: new Date(), dueDate: new Date(),
      total: 0, status: "OPEN", isDraft: true,
      items: { create: [{ itemId: anokItems[0].id, qty: 5, rate: 100, taxRate: 12, total: 560 }] },
    },
  });
  await mirrorUpdatePO(draft.id, {
    vendorId: anok.id, poDate: new Date(), dueDate: new Date(), notes: "edited",
    items: [
      { itemId: anokItems[0].id, qty: 8, rate: 110, taxRate: 12 },
      { itemId: anokItems[1].id, qty: 3, rate: 200, taxRate: 12 },
    ],
  });
  const draft2 = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true } });
  if (draft2.items.length !== 2 || draft2.notes !== "edited") fail("draft edit didn't apply");
  else pass(`draft edit: 1 line → 2 lines, notes updated`);
  await prisma.purchaseOrder.delete({ where: { id: draft.id } });

  // — SCENARIO 2: POSTED PO with one PARTIALLY received line.
  // Use an existing demo PO if it has a partial; otherwise create + bump manually.
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: `TST-PO-${Date.now()}`,
      vendorId: anok.id, poDate: new Date(), dueDate: new Date(),
      total: 1000, status: "OPEN", isDraft: false,
      items: { create: [
        { itemId: anokItems[0].id, qty: 10, rate: 100, taxRate: 12, total: 1120, receivedQty: 4 }, // partial
        { itemId: anokItems[1].id, qty: 5, rate: 200, taxRate: 12, total: 1120, receivedQty: 0 },  // untouched
      ] },
    },
    include: { items: true },
  });
  const poItem1 = po.items.find((i) => i.itemId === anokItems[0].id)!;
  const poItem2 = po.items.find((i) => i.itemId === anokItems[1].id)!;

  // 2a) Allowed edits: keep received line as-is, change unreceived line, ADD a new one.
  await mirrorUpdatePO(po.id, {
    vendorId: anok.id, poDate: new Date(), dueDate: new Date(), notes: null,
    items: [
      { poItemId: poItem1.id, itemId: anokItems[0].id, qty: 12, rate: 100, taxRate: 12 }, // qty 10→12 OK (above received 4)
      { poItemId: poItem2.id, itemId: anokItems[1].id, qty: 8, rate: 210, taxRate: 12 },  // unreceived: anything goes
      { itemId: anokItems[2].id, qty: 6, rate: 300, taxRate: 12 },                         // NEW row
    ],
  });
  const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
  if (after.items.length !== 3) fail("expected 3 items after add");
  else if (after.status !== "PARTIALLY_RECEIVED") fail(`status should be PARTIALLY_RECEIVED, got ${after.status}`);
  else pass(`posted PO partial edit: qty bumped, unreceived line edited, new line added, status PARTIALLY_RECEIVED`);

  // 2b) Forbidden: qty drop below received.
  try {
    await mirrorUpdatePO(po.id, {
      vendorId: anok.id, poDate: new Date(), dueDate: new Date(), notes: null,
      items: [
        { poItemId: poItem1.id, itemId: anokItems[0].id, qty: 2, rate: 100, taxRate: 12 }, // below received 4!
        { poItemId: poItem2.id, itemId: anokItems[1].id, qty: 8, rate: 210, taxRate: 12 },
      ],
    });
    fail("expected error when qty < received");
  } catch (e) {
    if (e instanceof Error && /received/i.test(e.message)) pass(`qty < received correctly blocked: "${e.message}"`);
    else fail(`unexpected error: ${e}`);
  }

  // 2c) Forbidden: change rate on received line.
  try {
    await mirrorUpdatePO(po.id, {
      vendorId: anok.id, poDate: new Date(), dueDate: new Date(), notes: null,
      items: [
        { poItemId: poItem1.id, itemId: anokItems[0].id, qty: 12, rate: 999, taxRate: 12 }, // rate change!
        { poItemId: poItem2.id, itemId: anokItems[1].id, qty: 8, rate: 210, taxRate: 12 },
      ],
    });
    fail("expected error when changing rate on received line");
  } catch (e) {
    if (e instanceof Error && /(rate|gst|locked)/i.test(e.message)) pass(`rate change on received line correctly blocked`);
    else fail(`unexpected error: ${e}`);
  }

  // 2d) Forbidden: remove a received line.
  try {
    await mirrorUpdatePO(po.id, {
      vendorId: anok.id, poDate: new Date(), dueDate: new Date(), notes: null,
      items: [
        { poItemId: poItem2.id, itemId: anokItems[1].id, qty: 8, rate: 210, taxRate: 12 },
      ],
    });
    fail("expected error when removing received line");
  } catch (e) {
    if (e instanceof Error && /received/i.test(e.message)) pass(`removing received line correctly blocked`);
    else fail(`unexpected error: ${e}`);
  }

  await prisma.purchaseOrder.delete({ where: { id: po.id } });

  done();
}

function done() {
  console.log("\n=== updatePO TEST SUMMARY ===");
  for (const s of summary) console.log("  " + s);
  console.log(failures === 0 ? "\nAll scenarios passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
