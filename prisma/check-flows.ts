/**
 * Deep flow-level inspector — exercises the cross-table invariants the UI
 * relies on, beyond what verify.ts checks. Runs read-only against the demo DB.
 *
 *   npx tsx prisma/check-flows.ts
 *
 * Each check prints PASS/FAIL with the row that failed; non-zero exit on any
 * failure so this can be wired into a pre-go-live gate.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

let failures = 0;
const FAIL = (msg: string) => { console.log("  ❌ " + msg); failures++; };
const OK = (msg: string) => console.log("  ✅ " + msg);

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // ── 1. ADMIN USER (the session-stale gotcha) ───────────────────────────────
  console.log("\n1. Admin user");
  const admins = await p.user.findMany({ where: { role: "ADMIN" }, select: { id: true, username: true, isActive: true } });
  if (admins.length === 0) FAIL("no ADMIN user — login impossible");
  else if (admins.length === 1 && admins[0].isActive) OK(`one active admin (${admins[0].username}, id ${admins[0].id})`);
  else OK(`${admins.length} admin(s); active: ${admins.filter(a=>a.isActive).length}`);

  // ── 2. VENDOR CODES + STATUS ───────────────────────────────────────────────
  console.log("\n2. Vendor codes & status");
  const vendors = await p.vendor.findMany({ select: { id: true, code: true, name: true, status: true, email: true, appliedAt: true } });
  const codes = vendors.map(v => v.code).filter(Boolean) as string[];
  if (new Set(codes).size !== codes.length) FAIL("duplicate vendor codes");
  else OK(`${codes.length} vendor code(s), all unique`);
  const badCode = vendors.find(v => v.code && !/^[A-Z0-9]{4}(-\d+)?$/.test(v.code));
  if (badCode) FAIL(`code "${badCode.code}" on ${badCode.name} doesn't match plain 4-char (or -N suffix) pattern`);
  else OK("all codes match plain format (no legacy -MODEL suffix)");
  const pending = vendors.filter(v => v.status === "PENDING");
  console.log(`     ${pending.length} PENDING vendor(s) ${pending.length ? "(" + pending.map(v=>v.name).join(", ") + ")" : ""}`);
  const pendingNoEmail = pending.filter(v => !v.email);
  if (pendingNoEmail.length) FAIL(`${pendingNoEmail.length} PENDING vendor(s) have no email — approval will fail until email is added`);

  // ── 3. PO RECEIVED-QTY vs GRN ──────────────────────────────────────────────
  console.log("\n3. PO receivedQty reconciles with GRN actuals");
  const poItems = await p.purchaseOrderItem.findMany({ select: { id: true, poId: true, itemId: true, qty: true, receivedQty: true, po: { select: { poNumber: true, status: true } } } });
  const grnByPoItem = await p.gRNItem.groupBy({ by: ["poItemId"], where: { poItemId: { not: null }, grn: { type: "PURCHASE" } }, _sum: { qty: true, rejectedQty: true } });
  const grnSumByPoItem = new Map(grnByPoItem.map(g => [g.poItemId!, (g._sum.qty ?? 0) - (g._sum.rejectedQty ?? 0)]));
  let poBad = 0;
  for (const pi of poItems) {
    const grnAccepted = grnSumByPoItem.get(pi.id) ?? 0;
    if (Math.abs(grnAccepted - pi.receivedQty) > 0.001) { FAIL(`PO ${pi.po.poNumber} item: receivedQty=${pi.receivedQty} but GRNs say ${grnAccepted}`); poBad++; }
  }
  if (poBad === 0) OK(`all ${poItems.length} PO line(s) match their GRN actuals`);
  // PO status sanity
  let statusBad = 0;
  const poGroups = new Map<string, { qty: number; rec: number; status: string; poNumber: string }>();
  for (const pi of poItems) {
    const g = poGroups.get(pi.poId) ?? { qty: 0, rec: 0, status: pi.po.status, poNumber: pi.po.poNumber };
    g.qty += pi.qty; g.rec += pi.receivedQty;
    poGroups.set(pi.poId, g);
  }
  for (const [, g] of poGroups) {
    const expected = g.rec >= g.qty ? "CLOSED" : g.rec > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
    if (g.status !== expected && g.status !== "CANCELLED") { FAIL(`${g.poNumber}: status=${g.status} but qty=${g.qty} rec=${g.rec} → expected ${expected}`); statusBad++; }
  }
  if (statusBad === 0) OK(`all ${poGroups.size} PO status(es) consistent with received qty`);

  // ── 4. GRN ITEM TOTALS = GRN.total ────────────────────────────────────────
  console.log("\n4. GRN headers reconcile with their line totals");
  const grns = await p.gRN.findMany({ select: { id: true, grnNo: true, total: true, items: { select: { totalValue: true } } } });
  let grnBad = 0;
  for (const g of grns) {
    const sum = g.items.reduce((s, i) => s + i.totalValue, 0);
    if (Math.abs(sum - g.total) > 0.01) { FAIL(`${g.grnNo}: header total=${r2(g.total)} but lines sum to ${r2(sum)}`); grnBad++; }
  }
  if (grnBad === 0) OK(`all ${grns.length} GRN(s) reconcile`);

  // ── 5. SALE.model SNAPSHOTS look sane ──────────────────────────────────────
  console.log("\n5. Sale.model snapshots present (model-aware payments need them)");
  const sales = await p.sale.findMany({ select: { id: true, model: true, item: { select: { skuCode: true } } } });
  const noModel = sales.filter(s => !s.model);
  if (noModel.length === 0) OK(`all ${sales.length} sale row(s) carry a model snapshot`);
  else FAIL(`${noModel.length} sale row(s) without a model — these will be skipped by the FTV/OR ledger`);

  // ── 6. GRNItem.model SNAPSHOTS ─────────────────────────────────────────────
  console.log("\n6. GRNItem.model snapshots present (OR ledger needs them)");
  const grnLines = await p.gRNItem.findMany({ select: { id: true, model: true, grn: { select: { type: true } } } });
  const noModelG = grnLines.filter(g => !g.model);
  if (noModelG.length === 0) OK(`all ${grnLines.length} GRN line(s) carry a model snapshot`);
  else FAIL(`${noModelG.length} GRN line(s) without a model — OR ledger may miss these`);

  // ── 7. MARKETPLACE ORDERS reference real items ─────────────────────────────
  console.log("\n7. MarketplaceOrder → Item references intact");
  const mos = await p.marketplaceOrder.findMany({ select: { id: true, marketplace: true, item: { select: { skuCode: true } } } });
  const moBad = mos.filter(o => !o.item);
  if (moBad.length === 0) OK(`all ${mos.length} marketplace order line(s) link to a real item`);
  else FAIL(`${moBad.length} marketplace orders point at missing items`);

  // ── 8. MARKETPLACE RATES exist for every channel that has orders ───────────
  console.log("\n8. Marketplace rates cover every channel used by orders");
  const channels = [...new Set(mos.map(o => o.marketplace))];
  const rates = await p.marketplaceRate.findMany({ select: { marketplace: true } });
  const rateNames = new Set(rates.map(r => r.marketplace.toLowerCase()));
  const missing = channels.filter(c => !rateNames.has(c.toLowerCase()));
  if (missing.length === 0) OK(`all ${channels.length} channel(s) have commission/logistics rates`);
  else FAIL(`Margin Report will show 0 commission/logistics for: ${missing.join(", ")}`);

  // ── 9. MARKETING COST SKUs exist ───────────────────────────────────────────
  console.log("\n9. Marketing cost rows reference real items");
  const mc = await p.marketingCost.findMany({ select: { id: true, month: true, item: { select: { skuCode: true } } } });
  const mcBad = mc.filter(m => !m.item);
  if (mcBad.length === 0) OK(`all ${mc.length} marketing-cost row(s) link to a real item`);
  else FAIL(`${mcBad.length} marketing-cost rows point at missing items`);

  // ── 10. DOC NUMBER SERIES — nextNumber is past the highest existing ───────
  console.log("\n10. Doc-number series ahead of highest existing doc");
  const series = await p.series.findMany();
  const checks: { docType: string; getDocs: () => Promise<string[]> }[] = [
    { docType: "PO",  getDocs: async () => (await p.purchaseOrder.findMany({ select: { poNumber: true } })).map(x => x.poNumber) },
    { docType: "GRN", getDocs: async () => (await p.gRN.findMany({ select: { grnNo: true } })).map(x => x.grnNo) },
    { docType: "SA",  getDocs: async () => (await p.stockAdjustment.findMany({ where: { adjNo: { not: null } }, select: { adjNo: true } })).map(x => x.adjNo!) },
    { docType: "TR",  getDocs: async () => (await p.warehouseTransfer.findMany({ where: { docNo: { not: null } }, select: { docNo: true } })).map(x => x.docNo!) },
    { docType: "ORP", getDocs: async () => (await p.orPayment.findMany({ where: { voucherNo: { not: null } }, select: { voucherNo: true } })).map(x => x.voucherNo!) },
    { docType: "DN",  getDocs: async () => (await p.otherCharge.findMany({ where: { direction: "DEBIT" }, select: { chargeNo: true } })).map(x => x.chargeNo) },
    { docType: "CN",  getDocs: async () => (await p.otherCharge.findMany({ where: { direction: "CREDIT" }, select: { chargeNo: true } })).map(x => x.chargeNo) },
  ];
  let seriesBad = 0;
  for (const c of checks) {
    const s = series.find(x => x.docType === c.docType);
    if (!s) { console.log(`     (no Series row for ${c.docType})`); continue; }
    const docs = await c.getDocs();
    const nums = docs.map(d => parseInt(d.replace(/[^0-9]/g, ""), 10)).filter(n => Number.isFinite(n) && n > 0);
    const max = nums.length ? Math.max(...nums) : 0;
    if (s.nextNumber <= max) { FAIL(`Series ${c.docType}: nextNumber=${s.nextNumber} but highest doc uses ${max} — next allocation will collide`); seriesBad++; }
  }
  if (seriesBad === 0) OK("every doc series is past the highest existing doc");

  // ── 11. VENDOR LEDGER reconciles credits vs debits per vendor (smoke) ──────
  console.log("\n11. Vendor ledger per-vendor: credits/debits add up");
  const vs = await p.vendor.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
  for (const v of vs) {
    const [grnSum, saleAgg, paySum, orPaySum, dnSum, cnSum] = await Promise.all([
      p.gRNItem.aggregate({ where: { grn: { vendorId: v.id, type: { in: ["PURCHASE", "RFV"] } }, model: "OR" }, _sum: { totalValue: true } }),
      p.sale.findMany({ where: { vendorId: v.id, model: { in: ["FTV", "FTV_NORETURN"] } }, select: { qtySold: true, qtyReturn: true, qtyRTO: true, unitRate: true, taxRate: true } }),
      p.payment.aggregate({ where: { vendorId: v.id, model: { in: ["FTV", "FTV_NORETURN"] } }, _sum: { amountPaid: true } }),
      p.orPayment.aggregate({ where: { vendorId: v.id }, _sum: { amount: true } }),
      p.otherCharge.aggregate({ where: { vendorId: v.id, direction: "DEBIT" }, _sum: { total: true } }),
      p.otherCharge.aggregate({ where: { vendorId: v.id, direction: "CREDIT" }, _sum: { total: true } }),
    ]);
    const grnRtv = await p.gRNItem.aggregate({ where: { grn: { vendorId: v.id, type: "RTV" }, model: "OR" }, _sum: { totalValue: true } });
    const saleCredit = saleAgg.reduce((s, x) => s + (x.qtySold - x.qtyReturn - x.qtyRTO) * x.unitRate * (1 + x.taxRate / 100), 0);
    const credit = (grnSum._sum.totalValue ?? 0) + saleCredit + (cnSum._sum.total ?? 0);
    const debit = (paySum._sum.amountPaid ?? 0) + (orPaySum._sum.amount ?? 0) + (grnRtv._sum.totalValue ?? 0) + (dnSum._sum.total ?? 0);
    const bal = credit - debit;
    console.log(`     ${v.name.padEnd(22)} credit=₹${r2(credit).toString().padStart(10)}  debit=₹${r2(debit).toString().padStart(10)}  balance=₹${r2(bal).toString().padStart(10)}`);
  }

  // ── 12. NO VENDOR-SCOPED USER WITHOUT VENDOR ──────────────────────────────
  console.log("\n12. Vendor-scoped users have a valid vendorId");
  const orphanUsers = await p.user.findMany({ where: { role: { in: ["VENDOR_ADMIN", "VENDOR_USER"] }, vendorId: null } });
  if (orphanUsers.length === 0) OK("no vendor-scoped users with null vendorId");
  else FAIL(`${orphanUsers.length} vendor-scoped user(s) with no vendorId`);

  // ── 13. ITEM EVERY-WHERE-SAME model? (revision model vs vendor.model legacy fallback) ─
  console.log("\n13. Items: latest revision carries a model");
  const items = await p.item.findMany({ select: { skuCode: true, vendor: { select: { model: true } }, priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } } } });
  const noRevModel = items.filter(i => !i.priceRevisions[0]?.model);
  if (noRevModel.length === 0) OK(`all ${items.length} item(s) have a model on the latest revision`);
  else FAIL(`${noRevModel.length} item(s) have no model on their latest revision — falling back to vendor.model: ${noRevModel.map(i => i.skuCode).join(", ")}`);

  // ── DONE ───────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? "🎉 All flow-level checks passed." : `⚠️  ${failures} flow check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
