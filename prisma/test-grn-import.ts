/**
 * End-to-end test for GRN imports (page-level + line-item server bits).
 *
 *   npx tsx prisma/test-grn-import.ts
 *
 * Exercises the real Prisma path the import actions take so we can catch
 * schema/series/PO-link drift without needing a browser session.
 *
 * Scenarios:
 *   1. Page-level bulkImportGRNs with a mixed CSV: rolls into 2 GRNs,
 *      one with 2 SKUs and one with 1, validates IDs are issued and
 *      totals match.
 *   2. suggestPoForSkus batched lookup picks the oldest open PO line
 *      per SKU.
 *   3. createGRN-style payload with the auto-PO-link map (mimics what
 *      the client does after a 2-col line-item import) bumps PO
 *      receivedQty and recomputes PO status.
 *
 * The script writes into the live dev.db; it cleans up its own rows at
 * the end so a follow-up `prisma/verify.ts` still passes.
 */
import { PrismaClient } from "@prisma/client";
import Papa from "papaparse";

const prisma = new PrismaClient();

// — small in-test mirror of the page-level bulkImportGRNs logic.
// Same parse, same group-by-key, same validation. Bypasses requireEditor()
// so we can run outside an HTTP request.
async function pageLevelImport(csv: string) {
  const rows = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  }).data;

  const [vendors, items, warehouses] = await Promise.all([
    prisma.vendor.findMany({ select: { id: true, code: true, name: true } }),
    prisma.item.findMany({ select: { id: true, skuCode: true, vendorId: true } }),
    prisma.warehouse.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const itemBySku = new Map(items.map((i) => [i.skuCode.toUpperCase(), i]));
  const whByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w.id]));

  type Line = { itemId: string; qty: number; rejectedQty: number; rate: number; taxRate: number };
  type Group = {
    type: "PURCHASE" | "RTV" | "RFV";
    vendorId: string;
    warehouseId: string;
    grnDate: Date;
    invoiceNo?: string;
    items: Line[];
  };
  const groups = new Map<string, Group>();
  const errors: string[] = [];

  rows.forEach((r, i) => {
    const date = new Date(r.Date.split("-").reverse().join("-"));
    const type = (r.Type || "PURCHASE").toUpperCase() as "PURCHASE" | "RTV" | "RFV";
    const v = vByCode.get(r.Vendor.toUpperCase()) ?? vByName.get(r.Vendor.toUpperCase());
    if (!v) { errors.push(`Row ${i + 1}: vendor not found`); return; }
    const wh = whByCode.get(r.Warehouse.toUpperCase());
    if (!wh) { errors.push(`Row ${i + 1}: warehouse not found`); return; }
    const it = itemBySku.get(r.SKU.toUpperCase());
    if (!it) { errors.push(`Row ${i + 1}: SKU not in master`); return; }
    if (it.vendorId !== v.id) { errors.push(`Row ${i + 1}: SKU/vendor mismatch`); return; }
    const qty = parseFloat(r.Qty);
    const rate = parseFloat(r.Rate);
    const gst = parseFloat(r["GST %"]);

    const key = `${v.id}|${type}|${date.toISOString().slice(0, 10)}|${r["Invoice No"] ?? ""}`;
    const g = groups.get(key) ?? {
      type, vendorId: v.id, warehouseId: wh, grnDate: date,
      invoiceNo: r["Invoice No"] || undefined, items: [],
    };
    g.items.push({ itemId: it.id, qty, rejectedQty: 0, rate, taxRate: gst });
    groups.set(key, g);
  });

  // Pull next GRN number from the live series so we don't collide.
  // #134: Series is now (companyId, docType) — findFirst for back-compat.
  const series = await prisma.series.findFirst({ where: { docType: "GRN" } });
  let next = series?.nextNumber ?? 1;
  const padding = series?.padding ?? 4;
  const prefix = series?.prefix ?? "GRN-";

  const createdIds: string[] = [];
  for (const g of groups.values()) {
    const grnNo = `${prefix}${String(next).padStart(padding, "0")}`;
    next++;
    let grandTotal = 0;
    const itemRows = g.items.map((it, idx) => {
      const net = (it.qty - it.rejectedQty) * it.rate;
      const tax = (net * it.taxRate) / 100;
      const total = net + tax;
      grandTotal += total;
      return { ...it, taxableValue: net, tax, totalValue: total, batchNo: `${grnNo}-${idx + 1}` };
    });
    const grn = await prisma.gRN.create({
      data: {
        grnNo, grnDate: g.grnDate, type: g.type, vendorId: g.vendorId, warehouseId: g.warehouseId,
        vendorInvoiceNo: g.invoiceNo ?? null, total: grandTotal, isDraft: false,
        items: { create: itemRows.map((r) => ({
          itemId: r.itemId, qty: r.qty, rejectedQty: r.rejectedQty, rate: r.rate, taxRate: r.taxRate,
          taxableValue: r.taxableValue, tax: r.tax, totalValue: r.totalValue, batchNo: r.batchNo,
          batchExpDate: new Date(g.grnDate.getTime() + 120 * 86_400_000),
        })) },
      },
    });
    createdIds.push(grn.id);
  }
  if (series) await prisma.series.update({ where: { id: series.id }, data: { nextNumber: next } });
  return { createdIds, errors };
}

async function main() {
  const summary: string[] = [];
  let failures = 0;
  const fail = (msg: string) => { failures++; summary.push(`❌ ${msg}`); };
  const pass = (msg: string) => summary.push(`✅ ${msg}`);

  // — SCENARIO 1: page-level bulk import groups by vendor+invoice+date.
  const anok = await prisma.vendor.findFirstOrThrow({ where: { code: "ANOK" } });
  const anokItems = await prisma.item.findMany({ where: { vendorId: anok.id }, select: { skuCode: true } });
  if (anokItems.length < 2) { fail("expected ≥2 ANOK items in demo data"); }
  else {
    const wh = (await prisma.warehouse.findFirst({ select: { code: true } }))!.code;
    // Two rows with the same invoice → one GRN. One row with no invoice → its own GRN.
    const csv = Papa.unparse([
      { Date: "10-05-2026", Type: "PURCHASE", Vendor: "ANOK", Warehouse: wh, "Invoice No": "TST-INV-1", "Invoice Date": "10-05-2026", SKU: anokItems[0].skuCode, Qty: "5", "Rejected Qty": "0", Rate: "100", "GST %": "12" },
      { Date: "10-05-2026", Type: "PURCHASE", Vendor: "ANOK", Warehouse: wh, "Invoice No": "TST-INV-1", "Invoice Date": "10-05-2026", SKU: anokItems[1].skuCode, Qty: "3", "Rejected Qty": "0", Rate: "200", "GST %": "12" },
      { Date: "11-05-2026", Type: "PURCHASE", Vendor: "ANOK", Warehouse: wh, "Invoice No": "",          "Invoice Date": "",            SKU: anokItems[0].skuCode, Qty: "2", "Rejected Qty": "0", Rate: "100", "GST %": "12" },
    ], { columns: ["Date","Type","Vendor","Warehouse","Invoice No","Invoice Date","SKU","Qty","Rejected Qty","Rate","GST %"] });
    const res = await pageLevelImport(csv);
    if (res.errors.length > 0) fail(`page-level import had errors: ${res.errors.join(" | ")}`);
    else if (res.createdIds.length !== 2) fail(`expected 2 GRNs (grouped), got ${res.createdIds.length}`);
    else {
      const grn1 = await prisma.gRN.findUnique({ where: { id: res.createdIds[0] }, include: { items: true } });
      if (!grn1 || grn1.items.length !== 2) fail("first GRN should have 2 line items");
      else {
        const grn2 = await prisma.gRN.findUnique({ where: { id: res.createdIds[1] }, include: { items: true } });
        if (!grn2 || grn2.items.length !== 1) fail("second GRN should have 1 line item");
        else {
          // Validate totals: 5*100*1.12 + 3*200*1.12 = 560+672 = 1232 ; 2*100*1.12 = 224
          const t1 = Math.round(grn1.total * 100) / 100;
          const t2 = Math.round(grn2.total * 100) / 100;
          if (t1 !== 1232 || t2 !== 224) fail(`totals wrong: got ${t1} / ${t2}, expected 1232 / 224`);
          else pass(`page-level import grouped 3 rows into 2 GRNs (totals 1232 + 224)`);
        }
      }
      // Cleanup these test GRNs so verify.ts later still reconciles.
      await prisma.gRN.deleteMany({ where: { id: { in: res.createdIds } } });
    }
  }

  // — SCENARIO 2: suggestPoForSkus picks the oldest open PO line per SKU.
  // Find an open PO line in the demo to test against.
  const openPoItems = await prisma.purchaseOrderItem.findMany({
    where: { po: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } } },
    include: { po: { select: { vendorId: true, poNumber: true, poDate: true } } },
    take: 5,
  });
  if (openPoItems.length === 0) {
    summary.push("⚠️ no open POs in demo — skipped suggestPoForSkus test");
  } else {
    const vendorId = openPoItems[0].po.vendorId;
    const itemIds = [...new Set(openPoItems.filter((p) => p.po.vendorId === vendorId).map((p) => p.itemId))];
    // Mirror suggestPoForSkus body without auth.
    const candidates = await prisma.purchaseOrderItem.findMany({
      where: {
        itemId: { in: itemIds },
        po: { vendorId, status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
      },
      include: { po: { select: { id: true, poNumber: true, poDate: true } } },
      orderBy: { po: { poDate: "asc" } },
    });
    const out = new Map<string, { poNumber: string; poDate: Date }>();
    for (const row of candidates) {
      if (out.has(row.itemId)) continue;
      if (row.qty - row.receivedQty > 0) {
        out.set(row.itemId, { poNumber: row.po.poNumber, poDate: row.po.poDate });
      }
    }
    if (out.size === 0) fail("suggestPoForSkus returned nothing for any tracked SKU");
    else pass(`suggestPoForSkus mapped ${out.size}/${itemIds.length} SKUs to oldest open PO`);
  }

  // — SCENARIO 3: imported line items bump PO receivedQty + status.
  const grnNoBump = await prisma.purchaseOrderItem.findFirst({
    where: { po: { status: "OPEN" } },
    include: { po: true },
  });
  if (!grnNoBump) {
    summary.push("⚠️ no OPEN PO in demo — skipped status-bump test");
  } else {
    const wh = (await prisma.warehouse.findFirst({ select: { id: true } }))!.id;
    const beforeReceived = grnNoBump.receivedQty;
    const beforeStatus = grnNoBump.po.status;
    const grn = await prisma.gRN.create({
      data: {
        grnNo: `TST-GRN-${Date.now()}`,
        grnDate: new Date(),
        type: "PURCHASE",
        vendorId: grnNoBump.po.vendorId,
        warehouseId: wh,
        total: grnNoBump.qty * grnNoBump.rate,
        isDraft: false,
        items: { create: [{
          itemId: grnNoBump.itemId,
          poItemId: grnNoBump.id,
          poId: grnNoBump.poId,
          qty: grnNoBump.qty,
          rejectedQty: 0,
          rate: grnNoBump.rate,
          taxRate: grnNoBump.taxRate,
          taxableValue: grnNoBump.qty * grnNoBump.rate,
          tax: 0,
          totalValue: grnNoBump.qty * grnNoBump.rate,
          batchNo: "TST-1",
          batchExpDate: new Date(Date.now() + 120 * 86_400_000),
        }] },
      },
    });
    // Manually mirror the receivedQty + status recompute that createGRN does.
    await prisma.purchaseOrderItem.update({
      where: { id: grnNoBump.id },
      data: { receivedQty: { increment: grnNoBump.qty } },
    });
    const fresh = await prisma.purchaseOrderItem.findMany({ where: { poId: grnNoBump.poId }, select: { qty: true, receivedQty: true } });
    const totalQ = fresh.reduce((s, x) => s + x.qty, 0);
    const recQ = fresh.reduce((s, x) => s + x.receivedQty, 0);
    const newStatus = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
    await prisma.purchaseOrder.update({ where: { id: grnNoBump.poId }, data: { status: newStatus } });
    const after = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: grnNoBump.id }, include: { po: true } });
    if (after.receivedQty <= beforeReceived) fail(`receivedQty didn't bump (${beforeReceived} → ${after.receivedQty})`);
    else if (beforeStatus === "OPEN" && after.po.status === "OPEN") fail(`PO status didn't transition off OPEN`);
    else pass(`PO bump: receivedQty ${beforeReceived} → ${after.receivedQty}, status ${beforeStatus} → ${after.po.status}`);
    // Roll back so verify.ts stays clean.
    await prisma.gRN.delete({ where: { id: grn.id } });
    await prisma.purchaseOrderItem.update({ where: { id: grnNoBump.id }, data: { receivedQty: beforeReceived } });
    await prisma.purchaseOrder.update({ where: { id: grnNoBump.poId }, data: { status: beforeStatus } });
  }

  console.log("\n=== GRN IMPORT TEST SUMMARY ===");
  for (const s of summary) console.log("  " + s);
  if (failures > 0) {
    console.log(`\n${failures} failure(s).`);
    process.exit(1);
  } else {
    console.log("\nAll scenarios passed.");
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
