/**
 * One-off consistency walkthrough (read-only). Independently recomputes the key
 * figures of each module from raw rows and prints a reconciliation report, so we
 * can confirm Stock Report / Stock Ledger / Inventory Valuation / Vendor Ledger /
 * Margin all agree and there are no negative-stock or money inconsistencies.
 *
 *   npx tsx prisma/verify.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const r2 = (n: number) => Math.round(n * 100) / 100;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

async function main() {
  const items = await prisma.item.findMany({
    select: {
      id: true, skuCode: true, vendorId: true,
      vendor: { select: { name: true, model: true } },
      priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true, transferPrice: true } },
    },
    orderBy: { skuCode: "asc" },
  });
  const grnLines = await prisma.gRNItem.findMany({ select: { itemId: true, qty: true, rejectedQty: true, rate: true, totalValue: true, model: true, grn: { select: { type: true, grnDate: true, vendorId: true, grnNo: true } } } });
  const sales = await prisma.sale.findMany({ select: { itemId: true, vendorId: true, qtySold: true, qtyReturn: true, qtyRTO: true, unitRate: true, taxRate: true, model: true, vchDate: true } });
  const adjustments = await prisma.stockAdjustment.findMany({ select: { itemId: true, qtyChange: true } });

  // ── 1. STOCK (Stock Report = Stock Ledger final balance) ────────────────────
  console.log("\n=== 1. STOCK BALANCE (purchase + rfv − rtv − sold + ret + rto + adj) ===");
  let negs = 0;
  const balByItem = new Map<string, number>();
  for (const it of items) {
    let inward = 0;
    for (const g of grnLines) {
      if (g.itemId !== it.id) continue;
      const acc = g.qty - g.rejectedQty;
      inward += g.grn.type === "RTV" ? -acc : acc; // PURCHASE & RFV add, RTV subtracts
    }
    let sold = 0, ret = 0, rto = 0;
    for (const s of sales) { if (s.itemId === it.id) { sold += s.qtySold; ret += s.qtyReturn; rto += s.qtyRTO; } }
    let adj = 0;
    for (const a of adjustments) if (a.itemId === it.id) adj += a.qtyChange;
    const bal = inward - sold + ret + rto + adj;
    balByItem.set(it.id, bal);
    const flag = bal < 0 ? "  ❌ NEGATIVE" : "";
    console.log(`  ${it.skuCode.padEnd(8)} bal=${String(r2(bal)).padStart(8)}  (in ${inward}, sold ${sold}, ret ${ret}, rto ${rto}, adj ${adj})${flag}`);
    if (bal < 0) negs++;
  }
  console.log(negs === 0 ? "  ✅ no negative stock" : `  ❌ ${negs} SKU(s) negative`);

  // ── 2. INVENTORY VALUATION (FIFO by receipt date) ───────────────────────────
  console.log("\n=== 2. INVENTORY VALUATION (FIFO; fallback latest transfer price) ===");
  let totalValue = 0;
  for (const it of items) {
    const layers = grnLines
      .filter((g) => g.itemId === it.id && g.grn.type !== "RTV")
      .map((g) => ({ qty: g.qty - g.rejectedQty, rate: g.rate, date: g.grn.grnDate.getTime() }))
      .sort((a, b) => a.date - b.date);
    const onHand = balByItem.get(it.id) ?? 0;
    const layerQty = layers.reduce((s, l) => s + l.qty, 0);
    let value = 0;
    let estimated = false;
    if (onHand > 0) {
      const keep = Math.min(onHand, layerQty);
      let consume = layerQty - keep;
      for (const l of layers) { if (consume >= l.qty) { consume -= l.qty; continue; } value += (l.qty - consume) * l.rate; consume = 0; }
      const excess = onHand - keep;
      if (excess > 0) { value += excess * (it.priceRevisions[0]?.transferPrice ?? 0); estimated = true; }
      if (layerQty === 0) estimated = true;
    }
    totalValue += value;
    const unit = onHand > 0 ? value / onHand : 0;
    console.log(`  ${it.skuCode.padEnd(8)} onHand=${String(r2(onHand)).padStart(7)}  fifoUnit=${String(r2(unit)).padStart(8)}  value=${String(r2(value)).padStart(10)}${estimated ? "  *est" : ""}`);
  }
  console.log(`  TOTAL INVENTORY VALUE = ₹${r2(totalValue)}`);

  // ── 3. VENDOR LEDGER (post-rework: every GRN credits regardless of model) ───
  console.log("\n=== 3. VENDOR LEDGER (every GRN credits; FTV gated by cutover) ===");
  const CUTOVER = new Date(process.env.FTV_LEDGER_CUTOVER_DATE ?? "2026-04-01");
  const masters = await prisma.modelMaster.findMany({ select: { code: true, paymentBasis: true, paymentTermDays: true } });
  const basisOf = (m: string | null) => {
    if (!m) return { basis: "ON_SALE", term: 0 };
    const c = masters.find((x) => x.code === m);
    return c ? { basis: c.paymentBasis, term: c.paymentTermDays } : (m === "OR" ? { basis: "ON_GRN", term: 45 } : { basis: "ON_SALE", term: 0 });
  };
  const payments = await prisma.payment.findMany({ where: { amountPaid: { gt: 0 } }, select: { vendorId: true, model: true, amountPaid: true } });
  const orPays = await prisma.orPayment.findMany({ select: { vendorId: true, amount: true } });
  const charges = await prisma.otherCharge.findMany({ select: { vendorId: true, direction: true, total: true, model: true } });
  const vendors = await prisma.vendor.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
  for (const v of vendors) {
    const byModel = new Map<string, { credit: number; debit: number; basis: string }>();
    const add = (model: string | null, credit: number, debit: number) => {
      const key = model ?? "—";
      const e = byModel.get(key) ?? { credit: 0, debit: 0, basis: model ? basisOf(model).basis : "—" };
      e.credit += credit; e.debit += debit; byModel.set(key, e);
    };
    // GRN posts for every model now. ON_SALE only when grnDate >= cutover.
    for (const g of grnLines) {
      if (g.grn.vendorId !== v.id || !g.model) continue;
      const b = basisOf(g.model);
      if (b.basis === "ON_SALE" && g.grn.grnDate < CUTOVER) continue;
      if (g.grn.type === "RTV") add(g.model, 0, g.totalValue);
      else add(g.model, g.totalValue, 0); // PURCHASE / RFV
    }
    // Sales no longer post to the ledger.
    for (const p of payments) { if (p.vendorId === v.id && basisOf(p.model).basis === "ON_SALE") add(p.model, 0, p.amountPaid); }
    const orModel = [...byModel.entries()].find(([, m]) => m.basis === "ON_GRN")?.[0] ?? "OR";
    for (const op of orPays) { if (op.vendorId === v.id) add(orModel, 0, op.amount); }
    for (const c of charges) { if (c.vendorId === v.id) add(c.model, c.direction === "CREDIT" ? c.total : 0, c.direction === "CREDIT" ? 0 : c.total); }

    const parts = [...byModel.entries()].map(([k, m]) => `${k}[${m.basis}] credit=${r2(m.credit)} debit=${r2(m.debit)} bal=${r2(m.credit - m.debit)}`);
    console.log(`  ${v.name}: ${parts.join(" | ")}`);
  }

  // ── 4. MARGIN REPORT (month 2026-05) ────────────────────────────────────────
  console.log("\n=== 4. MARGIN REPORT — 2026-05 (taxable basis) ===");
  const month = "2026-05";
  const [y, mo] = month.split("-").map(Number);
  const mos = await prisma.marketplaceOrder.findMany({
    where: { date: { gte: new Date(Date.UTC(y, mo - 1, 1)), lt: new Date(Date.UTC(y, mo, 1)) } },
    select: { itemId: true, marketplace: true, type: true, qty: true, taxableValue: true },
  });
  const rates = await prisma.marketplaceRate.findMany();
  const rateOf = (m: string) => rates.find((x) => x.marketplace.toLowerCase() === m.toLowerCase());
  const mc = await prisma.marketingCost.findMany({ where: { month }, select: { itemId: true, amount: true } });
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const agg = new Map<string, { sale: number; ret: number; rto: number; comm: number; logi: number; netQty: number }>();
  for (const o of mos) {
    const a = agg.get(o.itemId) ?? { sale: 0, ret: 0, rto: 0, comm: 0, logi: 0, netQty: 0 };
    const sign = o.type === "RETURN" || o.type === "RTO" ? -1 : 1;
    if (o.type === "RETURN") a.ret += o.taxableValue; else if (o.type === "RTO") a.rto += o.taxableValue; else a.sale += o.taxableValue;
    a.netQty += sign * o.qty;
    const rt = rateOf(o.marketplace);
    if (rt) { a.comm += sign * o.taxableValue * (rt.commissionPct / 100); a.logi += sign * o.taxableValue * (rt.logisticsPct / 100); }
    agg.set(o.itemId, a);
  }
  let tNet = 0, tMargin = 0, tCogs = 0, tNetMargin = 0;
  for (const [itemId, a] of agg) {
    const it = itemMap.get(itemId)!;
    const netSale = a.sale - a.ret - a.rto;
    const mkt = mc.filter((x) => x.itemId === itemId).reduce((s, x) => s + x.amount, 0);
    const margin = netSale - a.comm - a.logi - mkt;
    const cogs = (it.priceRevisions[0]?.transferPrice ?? 0) * a.netQty;
    const netMargin = margin - cogs;
    tNet += netSale; tMargin += margin; tCogs += cogs; tNetMargin += netMargin;
    console.log(`  ${it.skuCode.padEnd(8)} net=${String(r2(netSale)).padStart(9)} comm=${String(r2(a.comm)).padStart(8)} logi=${String(r2(a.logi)).padStart(7)} mktg=${String(mkt).padStart(6)} margin=${String(r2(margin)).padStart(9)} cogs=${String(r2(cogs)).padStart(8)} netMargin=${String(r2(netMargin)).padStart(9)}`);
  }
  console.log(`  TOTALS: netSale=₹${r2(tNet)} margin=₹${r2(tMargin)} cogs=₹${r2(tCogs)} netMargin=₹${r2(tNetMargin)}`);

  // ── 5. PER-WAREHOUSE STOCK (includes transfers; should reconcile with totals) ─
  console.log("\n=== 5. PER-WAREHOUSE STOCK (transfers move qty between warehouses) ===");
  const warehouses = await prisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const transfers = await prisma.warehouseTransfer.findMany({
    where: { fromWarehouseId: { not: null }, toWarehouseId: { not: null } },
    select: { itemId: true, fromWarehouseId: true, toWarehouseId: true, qty: true },
  });
  const grnWh = await prisma.gRNItem.findMany({ select: { itemId: true, qty: true, rejectedQty: true, grn: { select: { type: true, warehouseId: true } } } });
  const saleWh = await prisma.sale.findMany({ select: { itemId: true, warehouseId: true, qtySold: true, qtyReturn: true, qtyRTO: true } });
  const adjWh = await prisma.stockAdjustment.findMany({ select: { itemId: true, warehouseId: true, qtyChange: true } });
  type PerWh = Map<string, number>;
  const byItemWh = new Map<string, PerWh>();
  const bump = (itemId: string, whId: string, d: number) => {
    let m = byItemWh.get(itemId); if (!m) { m = new Map(); byItemWh.set(itemId, m); }
    m.set(whId, (m.get(whId) ?? 0) + d);
  };
  const UN = "(unassigned)";
  for (const g of grnWh) { const acc = g.qty - g.rejectedQty; bump(g.itemId, g.grn.warehouseId ?? UN, g.grn.type === "RTV" ? -acc : acc); }
  for (const s of saleWh) bump(s.itemId, s.warehouseId ?? UN, -s.qtySold + s.qtyReturn + s.qtyRTO);
  for (const a of adjWh) bump(a.itemId, a.warehouseId ?? UN, a.qtyChange);
  for (const t of transfers) { bump(t.itemId, t.fromWarehouseId!, -t.qty); bump(t.itemId, t.toWarehouseId!, t.qty); }

  let mismatches = 0;
  for (const it of items) {
    const m = byItemWh.get(it.id);
    if (!m) continue;
    const perWh = warehouses.map((w) => `${w.code}=${r2(m.get(w.id) ?? 0)}`).join(" ");
    const sumWh = [...m.values()].reduce((s, v) => s + v, 0);
    const total = balByItem.get(it.id) ?? 0;
    const ok = Math.abs(sumWh - total) < 0.001;
    if (!ok) mismatches++;
    console.log(`  ${it.skuCode.padEnd(8)} ${perWh}  Σ=${r2(sumWh)}  total=${r2(total)} ${ok ? "✅" : "❌"}`);
  }
  console.log(mismatches === 0 ? "  ✅ per-warehouse Σ matches total stock for every SKU" : `  ❌ ${mismatches} SKU(s) mismatched`);

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
