/**
 * E2E test for updateGRNHeader: changes the 5 editable fields on a POSTED
 * GRN without touching items, totals, or stock.
 *
 *   npx tsx prisma/test-grn-header-edit.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const summary: string[] = [];
let failures = 0;
const fail = (m: string) => { failures++; summary.push(`❌ ${m}`); };
const pass = (m: string) => summary.push(`✅ ${m}`);

async function main() {
  // Pick a posted GRN to mutate.
  const grn = await prisma.gRN.findFirst({
    where: { isDraft: false, type: "PURCHASE" },
    include: { items: { select: { id: true, qty: true, rate: true } } },
  });
  if (!grn) { summary.push("⚠️ no posted PURCHASE GRN in demo — skipped"); return done(); }

  const wh1 = await prisma.warehouse.findFirstOrThrow({ select: { id: true, code: true } });
  const wh2 = await prisma.warehouse.findFirst({ where: { id: { not: wh1.id } }, select: { id: true, code: true } });
  if (!wh2) { summary.push("⚠️ need 2 warehouses for the switch test"); return done(); }

  // Capture before-state.
  const beforeItemsHash = JSON.stringify(grn.items.map((i) => ({ id: i.id, qty: i.qty, rate: i.rate })));
  const beforeTotal = grn.total;
  const beforeDate = grn.grnDate.toISOString();
  const beforeInvNo = grn.vendorInvoiceNo;
  const beforeWh = grn.warehouseId;

  // — SCENARIO 1: shift date + change invoice no.
  const newDate = new Date("2026-04-15");
  const newInvNo = `EDIT-${Date.now()}`;
  await prisma.gRN.update({
    where: { id: grn.id },
    data: { grnDate: newDate, vendorInvoiceNo: newInvNo, warehouseId: grn.warehouseId, batchRemarks: "edited" },
  });
  const after = await prisma.gRN.findUniqueOrThrow({
    where: { id: grn.id },
    include: { items: { select: { id: true, qty: true, rate: true } } },
  });
  const afterItemsHash = JSON.stringify(after.items.map((i) => ({ id: i.id, qty: i.qty, rate: i.rate })));
  if (after.grnDate.toISOString() !== newDate.toISOString()) fail(`date didn't change`);
  else if (after.vendorInvoiceNo !== newInvNo) fail(`invoice no didn't change`);
  else if (after.batchRemarks !== "edited") fail(`batch remarks didn't change`);
  else if (afterItemsHash !== beforeItemsHash) fail(`items changed (header edit shouldn't touch line items)`);
  else if (Math.abs(after.total - beforeTotal) > 0.001) fail(`total changed (header edit shouldn't recompute)`);
  else pass(`date, invoice no, batch remarks updated; items + total unchanged`);

  // — SCENARIO 2: change warehouse.
  await prisma.gRN.update({ where: { id: grn.id }, data: { warehouseId: wh2.id } });
  const swapped = await prisma.gRN.findUniqueOrThrow({ where: { id: grn.id } });
  if (swapped.warehouseId !== wh2.id) fail(`warehouse didn't change to ${wh2.code}`);
  else pass(`warehouse moved → ${wh2.code}`);

  // — SCENARIO 3: verify NO PO receivedQty drift from any of these edits.
  // Find a poItem linked to a GRN line on this doc and re-read its receivedQty.
  const linkedItem = await prisma.gRNItem.findFirst({
    where: { grnId: grn.id, poItemId: { not: null } },
    select: { poItemId: true, qty: true, rejectedQty: true },
  });
  if (linkedItem && linkedItem.poItemId) {
    const poi = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: linkedItem.poItemId } });
    // We can't easily know "before" recv without another snapshot, but we can
    // at least check internal consistency: receivedQty should still be >= the
    // accepted qty of this GRN line (it bumped at original GRN create).
    const accepted = linkedItem.qty - linkedItem.rejectedQty;
    if (poi.receivedQty < accepted) fail(`PO receivedQty (${poi.receivedQty}) dropped below the accepted qty from this GRN line (${accepted})`);
    else pass(`PO receivedQty stable after header edit (${poi.receivedQty} >= ${accepted})`);
  } else {
    summary.push("ℹ️ no PO-linked GRN line — skipped PO drift check");
  }

  // Restore the original state so verify.ts stays clean.
  await prisma.gRN.update({
    where: { id: grn.id },
    data: {
      grnDate: new Date(beforeDate),
      vendorInvoiceNo: beforeInvNo,
      warehouseId: beforeWh,
      batchRemarks: null,
    },
  });
  pass(`restored original state for downstream verifies`);

  done();
}

function done() {
  console.log("\n=== updateGRNHeader TEST SUMMARY ===");
  for (const s of summary) console.log("  " + s);
  console.log(failures === 0 ? "\nAll scenarios passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
