/**
 * Demo / test data seeder.
 *
 *   pnpm db:demo            (or: npx tsx prisma/demo.ts)
 *
 * RESET MODE: wipes all transactional data + demo masters (vendors, items,
 * categories, warehouses) and reseeds a consistent dataset that exercises every
 * module — including the multi-model money logic (FTV ON_SALE / OR ON_GRN) and
 * the Marketplace / Margin modules. PRESERVES the admin user and AuditLog.
 *
 * Reflects the current system:
 *  - Plain vendor codes (no -MODEL suffix); vendor.model kept dormant.
 *  - Model lives on each item's price revision; Sale.model & GRNItem.model carry
 *    the date-snapshot the ledger/payment engines read.
 *  - Covers PURCHASE / RTV / RFV GRNs, OR payments, Dr/Cr notes, marketplace
 *    orders (SALE/RETURN/RTO), marketing cost, and marketplace rates.
 *  - Every sold SKU has enough inward stock to stay non-negative.
 */
import { PrismaClient } from "@prisma/client";
import { stampCompanyId } from "./_stamp-company";

const prisma = new PrismaClient();

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * 86_400_000);
const BATCH_EXPIRY_DAYS = 120;
const HOME_STATE = "Uttar Pradesh";

/** Plain vendor code: first 4 alphanumerics, upper, padded with X. */
function vendorCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, "X");
}

async function wipe() {
  // Order respects FK constraints (several are onDelete: Restrict).
  await prisma.marketplaceOrder.deleteMany();
  await prisma.marketingCost.deleteMany();
  await prisma.marketplaceRate.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orPayment.deleteMany();
  await prisma.otherCharge.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.warehouseTransfer.deleteMany();
  await prisma.gRNItem.deleteMany();
  await prisma.gRN.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.itemPriceRevision.deleteMany();
  await prisma.item.deleteMany();
  await prisma.category.updateMany({ data: { parentId: null } });
  await prisma.category.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.vendorInvite.deleteMany();
  await prisma.user.deleteMany({ where: { vendorId: { not: null } } });
  await prisma.vendor.deleteMany();
}

async function main() {
  console.log("Wiping existing data (keeping admin + audit)…");
  await wipe();

  // ── Model Master (ensure payment basis is correct for the money logic) ──────
  const models: { code: string; label: string; basis: string; term: number; sort: number }[] = [
    { code: "FTV", label: "FTV (Pay on Sale)", basis: "ON_SALE", term: 0, sort: 1 },
    { code: "OR", label: "OR (Outright, GRN+45)", basis: "ON_GRN", term: 45, sort: 2 },
    { code: "FTV_NORETURN", label: "FTV — No Return", basis: "ON_SALE", term: 0, sort: 3 },
  ];
  for (const m of models) {
    await prisma.modelMaster.upsert({
      where: { code: m.code },
      update: { label: m.label, paymentBasis: m.basis, paymentTermDays: m.term, isActive: true, sortOrder: m.sort },
      create: { code: m.code, label: m.label, paymentBasis: m.basis, paymentTermDays: m.term, isActive: true, sortOrder: m.sort },
    });
  }

  // ── Warehouses ──────────────────────────────────────────────────────────────
  const whMain = await prisma.warehouse.create({ data: { code: "WH-001", name: "Main — Surajpur", address: "Surajpur, Greater Noida" } });
  const whMumbai = await prisma.warehouse.create({ data: { code: "WH-002", name: "Mumbai DC", address: "Bhiwandi, Mumbai" } });

  // ── Categories (tree) ─────────────────────────────────────────────────────────
  const apparel = await prisma.category.create({ data: { name: "Apparel" } });
  const accessories = await prisma.category.create({ data: { name: "Accessories" } });
  const sarees = await prisma.category.create({ data: { name: "Sarees", parentId: apparel.id } });
  const kurtis = await prisma.category.create({ data: { name: "Kurtis", parentId: apparel.id } });
  const jewellery = await prisma.category.create({ data: { name: "Jewellery", parentId: accessories.id } });

  // ── Vendors (plain codes; model kept dormant) ───────────────────────────────────
  const mkVendor = (name: string, model: string, extra: Record<string, unknown>) =>
    prisma.vendor.create({ data: { name, model, code: vendorCode(name), status: "ACTIVE", ...extra } });

  const anokhi = await mkVendor("Anokhi Textiles", "FTV", {
    email: "accounts@anokhi.example.com", whatsapp: "919812345670", contactName: "Meera Shah",
    gst: "09AAACA1234A1Z5", pan: "AAACA1234A", ifsc: "HDFC0001234", bankName: "HDFC Bank", accountNo: "501000123456", address: "Sadar Bazaar, Jaipur",
    staleDays: 30, // tighter than default — surfaces aged stock in the demo
  });
  const rajwadi = await mkVendor("Rajwadi Crafts", "OR", {
    email: "hello@rajwadi.example.com", whatsapp: "919812345671", contactName: "Karan Mehta",
    gst: "24AABCR5678B1Z2", pan: "AABCR5678B", ifsc: "ICIC0005678", bankName: "ICICI Bank", accountNo: "602000654321", address: "Ring Road, Surat",
  });
  const surat = await mkVendor("Surat Silk Mills", "FTV_NORETURN", {
    email: "sales@suratsilk.example.com", whatsapp: "919812345672", contactName: "Priya Desai",
    gst: "24AAACS9012C1Z9", pan: "AAACS9012C", ifsc: "SBIN0009012", bankName: "State Bank of India", accountNo: "703000789012", address: "Textile Market, Surat",
  });
  const delhi = await mkVendor("Delhi Drapes", "FTV", {
    email: "info@delhidrapes.example.com", whatsapp: "919812345673", contactName: "Aman Gupta",
    gst: "07AADCD3456D1Z1", pan: "AADCD3456D", ifsc: "AXIS0003456", bankName: "Axis Bank", accountNo: "804000345678", address: "Chandni Chowk, Delhi",
    staleDays: 45,
  });

  // A PENDING application (to exercise the review/approve flow).
  await prisma.vendor.create({
    data: {
      name: "Bloom Boutique", status: "PENDING", email: "founder@bloomboutique.example.com",
      contactName: "Sara Khan", designation: "Founder", businessType: "BOUTIQUE_DESIGNER",
      yearsInBusiness: "3", productCategoryHint: "Designer kurtis & dresses", productCountRange: "50-100",
      priceRange: "800-3000", applicationNotes: "Referred by an existing vendor.", appliedAt: D("2026-05-20"),
    },
  });

  // ── Items + price revisions (model lives on the revision) ─────────────────────
  type ItemSpec = {
    sku: string; name: string; hsn: string; vendorId: string; model: string; categoryId: string;
    rate: number; tax: number; older?: { rate: number; date: string };
  };
  const itemSpecs: ItemSpec[] = [
    { sku: "SAR-001", name: "Banarasi Silk Saree", hsn: "5007", vendorId: anokhi.id, model: "FTV", categoryId: sarees.id, rate: 1250, tax: 5, older: { rate: 1100, date: "2026-01-01" } },
    { sku: "SAR-002", name: "Kanjivaram Saree", hsn: "5007", vendorId: surat.id, model: "FTV_NORETURN", categoryId: sarees.id, rate: 2500, tax: 5 },
    { sku: "SAR-003", name: "Chiffon Printed Saree", hsn: "5407", vendorId: anokhi.id, model: "FTV", categoryId: sarees.id, rate: 820, tax: 5 },
    { sku: "KUR-001", name: "Cotton Straight Kurti", hsn: "6204", vendorId: rajwadi.id, model: "OR", categoryId: kurtis.id, rate: 600, tax: 12 },
    { sku: "KUR-002", name: "Silk Anarkali Kurti", hsn: "6204", vendorId: anokhi.id, model: "FTV", categoryId: kurtis.id, rate: 950, tax: 12 },
    { sku: "KUR-003", name: "Rayon Printed Kurti", hsn: "6204", vendorId: rajwadi.id, model: "OR", categoryId: kurtis.id, rate: 540, tax: 12, older: { rate: 500, date: "2026-02-01" } },
    { sku: "JWL-001", name: "Kundan Necklace Set", hsn: "7117", vendorId: delhi.id, model: "FTV", categoryId: jewellery.id, rate: 1500, tax: 3 },
    { sku: "JWL-002", name: "Jhumka Earrings", hsn: "7117", vendorId: delhi.id, model: "FTV", categoryId: jewellery.id, rate: 420, tax: 3 },
  ];

  const itemBySku = new Map<string, { id: string; vendorId: string; model: string; rate: number; tax: number }>();
  for (const s of itemSpecs) {
    const revisions = [{ transferPrice: s.rate, taxRate: s.tax, model: s.model, effectiveDate: D("2026-04-01") }];
    if (s.older) revisions.unshift({ transferPrice: s.older.rate, taxRate: s.tax, model: s.model, effectiveDate: D(s.older.date) });
    const created = await prisma.item.create({
      data: { skuCode: s.sku, name: s.name, hsn: s.hsn, vendorId: s.vendorId, categoryId: s.categoryId, priceRevisions: { create: revisions } },
    });
    itemBySku.set(s.sku, { id: created.id, vendorId: s.vendorId, model: s.model, rate: s.rate, tax: s.tax });
  }

  // ── Purchase Orders ───────────────────────────────────────────────────────────
  const mkPO = async (poNumber: string, vendorId: string, poDate: string, dueDate: string, lines: { sku: string; qty: number }[]) => {
    let total = 0;
    const items = lines.map((l) => {
      const it = itemBySku.get(l.sku)!;
      const net = l.qty * it.rate;
      const tax = (net * it.tax) / 100;
      total += net + tax;
      return { itemId: it.id, qty: l.qty, rate: it.rate, taxRate: it.tax, total: net + tax };
    });
    return prisma.purchaseOrder.create({
      data: { poNumber, vendorId, poDate: D(poDate), dueDate: D(dueDate), status: "OPEN", total, items: { create: items } },
      include: { items: true },
    });
  };

  const po1 = await mkPO("PO-00001", anokhi.id, "2026-04-02", "2026-04-20", [{ sku: "SAR-001", qty: 50 }, { sku: "KUR-002", qty: 40 }, { sku: "SAR-003", qty: 30 }]);
  const po2 = await mkPO("PO-00002", rajwadi.id, "2026-04-05", "2026-04-25", [{ sku: "KUR-001", qty: 100 }, { sku: "KUR-003", qty: 60 }]);
  await mkPO("PO-00003", surat.id, "2026-05-10", "2026-05-30", [{ sku: "SAR-002", qty: 20 }]); // open, partly received below
  const po4 = await mkPO("PO-00004", delhi.id, "2026-04-06", "2026-04-22", [{ sku: "JWL-001", qty: 30 }, { sku: "JWL-002", qty: 40 }]);

  const poItem = (po: typeof po1, sku: string) => po.items.find((i) => i.itemId === itemBySku.get(sku)!.id)!;

  // ── GRNs (PURCHASE / RTV / RFV) with model snapshots ───────────────────────────
  const mkGRN = async (
    grnNo: string, vendorId: string, grnDate: string, type: "PURCHASE" | "RTV" | "RFV",
    warehouseId: string | null, invNo: string | null,
    lines: { sku: string; qty: number; rejected?: number; poItemId?: string; poId?: string }[],
  ) => {
    const exp = addDays(D(grnDate), BATCH_EXPIRY_DAYS);
    let total = 0;
    const items = lines.map((l, idx) => {
      const it = itemBySku.get(l.sku)!;
      const accepted = l.qty - (l.rejected ?? 0);
      const taxableValue = accepted * it.rate;
      const tax = (taxableValue * it.tax) / 100;
      total += taxableValue + tax;
      return {
        itemId: it.id, poItemId: l.poItemId ?? null, poId: l.poId ?? null, model: it.model,
        qty: l.qty, rejectedQty: l.rejected ?? 0, rate: it.rate, taxRate: it.tax,
        taxableValue, tax, totalValue: taxableValue + tax,
        batchNo: `${grnNo}-${idx + 1}`, batchExpDate: exp,
      };
    });
    const grn = await prisma.gRN.create({
      data: { grnNo, vendorId, grnDate: D(grnDate), type, warehouseId, vendorInvoiceNo: invNo, total, items: { create: items } },
    });
    if (type === "PURCHASE") {
      for (const l of lines) {
        if (l.poItemId) {
          await prisma.purchaseOrderItem.update({ where: { id: l.poItemId }, data: { receivedQty: { increment: l.qty - (l.rejected ?? 0) } } });
        }
      }
    }
    return grn;
  };

  // FTV purchase (stock only — no ledger credit).
  await mkGRN("GRN-00001", anokhi.id, "2026-04-08", "PURCHASE", whMain.id, "ANK/INV/441", [
    { sku: "SAR-001", qty: 50, poItemId: poItem(po1, "SAR-001").id, poId: po1.id },
    { sku: "KUR-002", qty: 40, poItemId: poItem(po1, "KUR-002").id, poId: po1.id },
    { sku: "SAR-003", qty: 30, poItemId: poItem(po1, "SAR-003").id, poId: po1.id },
  ]);
  // OR purchase (credits the OR ledger, due GRN+45).
  await mkGRN("GRN-00002", rajwadi.id, "2026-04-12", "PURCHASE", whMain.id, "RAJ/2026/118", [
    { sku: "KUR-001", qty: 80, rejected: 5, poItemId: poItem(po2, "KUR-001").id, poId: po2.id },
    { sku: "KUR-003", qty: 60, poItemId: poItem(po2, "KUR-003").id, poId: po2.id },
  ]);
  // RTV — return defective OR kurtis to Rajwadi (OR ledger debit, stock −).
  await mkGRN("GRN-00003", rajwadi.id, "2026-04-18", "RTV", whMain.id, "DN-OR-009", [{ sku: "KUR-001", qty: 4 }]);
  // FTV purchase for Delhi jewellery (stock only).
  await mkGRN("GRN-00004", delhi.id, "2026-04-09", "PURCHASE", whMumbai.id, "DEL/77", [
    { sku: "JWL-001", qty: 30, poItemId: poItem(po4, "JWL-001").id, poId: po4.id },
    { sku: "JWL-002", qty: 40, poItemId: poItem(po4, "JWL-002").id, poId: po4.id },
  ]);
  // FTV RTV — return 4 sarees to Anokhi (stock −; FTV so no ledger posting).
  await mkGRN("GRN-00005", anokhi.id, "2026-04-15", "RTV", whMain.id, "ANK-RTV-02", [{ sku: "SAR-001", qty: 4 }]);
  // RFV — Reject-In: 3 kurtis re-received from Rajwadi (stock +, OR credit).
  await mkGRN("GRN-00006", rajwadi.id, "2026-05-06", "RFV", whMain.id, "RAJ-RFV-01", [{ sku: "KUR-003", qty: 3 }]);

  // Recompute PO statuses from receivedQty.
  for (const poId of [po1.id, po2.id, po4.id]) {
    const lines = await prisma.purchaseOrderItem.findMany({ where: { poId }, select: { qty: true, receivedQty: true } });
    const totalQ = lines.reduce((s, i) => s + i.qty, 0);
    const recQ = lines.reduce((s, i) => s + i.receivedQty, 0);
    const status = recQ >= totalQ ? "CLOSED" : recQ > 0 ? "PARTIALLY_RECEIVED" : "OPEN";
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status } });
  }

  // ── Sales (internal — transfer price; model snapshot drives FTV payout) ─────────
  type SaleSpec = { date: string; mkt: string; sku: string; sold?: number; ret?: number; rto?: number; type: "SALE" | "RETURN"; wh?: string };
  const saleSpecs: SaleSpec[] = [
    { date: "2026-04-10", mkt: "Myntra", sku: "SAR-001", sold: 6, type: "SALE", wh: whMain.id },
    { date: "2026-04-11", mkt: "Amazon", sku: "KUR-002", sold: 10, type: "SALE", wh: whMain.id },
    { date: "2026-04-13", mkt: "Flipkart", sku: "KUR-001", sold: 18, type: "SALE", wh: whMain.id },
    { date: "2026-04-15", mkt: "Myntra", sku: "JWL-001", sold: 4, type: "SALE", wh: whMumbai.id },
    { date: "2026-04-18", mkt: "Amazon", sku: "SAR-001", ret: 1, type: "RETURN", wh: whMain.id },
    { date: "2026-04-20", mkt: "Nykaa", sku: "JWL-002", sold: 12, type: "SALE", wh: whMumbai.id },
    { date: "2026-04-22", mkt: "Flipkart", sku: "KUR-001", sold: 9, rto: 2, type: "SALE", wh: whMain.id },
    { date: "2026-05-03", mkt: "Myntra", sku: "KUR-002", sold: 7, type: "SALE", wh: whMain.id },
    { date: "2026-05-05", mkt: "Amazon", sku: "SAR-003", sold: 5, type: "SALE", wh: whMain.id },
    { date: "2026-05-08", mkt: "Nykaa", sku: "JWL-001", ret: 1, type: "RETURN", wh: whMumbai.id },
    { date: "2026-05-12", mkt: "Flipkart", sku: "KUR-003", sold: 14, type: "SALE", wh: whMain.id },
    { date: "2026-05-18", mkt: "Myntra", sku: "SAR-001", sold: 3, type: "SALE", wh: whMain.id },
  ];
  for (const s of saleSpecs) {
    const it = itemBySku.get(s.sku)!;
    await prisma.sale.create({
      data: {
        vchDate: D(s.date), marketplace: s.mkt, itemId: it.id, vendorId: it.vendorId, warehouseId: s.wh ?? null,
        transactionType: s.type, model: it.model, qtySold: s.sold ?? 0, qtyReturn: s.ret ?? 0, qtyRTO: s.rto ?? 0,
        unitRate: it.rate, taxRate: it.tax,
      },
    });
  }

  // ── FTV payments (month-based, ON_SALE models) ──────────────────────────────────
  await prisma.payment.createMany({
    data: [
      { vendorId: anokhi.id, month: "2026-04", model: "FTV", amountPaid: 12000, status: "PAID", utr: "UTR4410012", paidOn: D("2026-05-05") },
      { vendorId: delhi.id, month: "2026-04", model: "FTV", amountPaid: 0, status: "PENDING" },
      { vendorId: surat.id, month: "2026-05", model: "FTV_NORETURN", amountPaid: 0, status: "PENDING" },
      { vendorId: anokhi.id, month: "2026-05", model: "FTV", amountPaid: 0, status: "PENDING" },
    ],
  });

  // ── OR payments (free-form vouchers against Rajwadi's OR balance) ────────────────
  await prisma.orPayment.create({
    data: { voucherNo: "ORP-00001", vendorId: rajwadi.id, date: D("2026-05-20"), amount: 30000, reference: "UTR-OR-55012", particulars: "Part payment vs Apr GRNs" },
  });

  // ── Dr/Cr notes (affect the vendor ledger) ───────────────────────────────────────
  await prisma.otherCharge.create({
    data: { chargeNo: "DN-00001", date: D("2026-04-25"), vendorId: anokhi.id, direction: "DEBIT", model: "FTV", reason: "Logistics recovery", taxable: 500, gstRate: 18, gst: 90, total: 590 },
  });
  await prisma.otherCharge.create({
    data: { chargeNo: "CN-00001", date: D("2026-05-10"), vendorId: rajwadi.id, direction: "CREDIT", model: "OR", reason: "Price difference credit", taxable: 1000, gstRate: 0, gst: 0, total: 1000 },
  });

  // ── Stock adjustments ─────────────────────────────────────────────────────────────
  await prisma.stockAdjustment.create({
    data: { adjNo: "SA-00001", date: D("2026-05-15"), itemId: itemBySku.get("KUR-001")!.id, warehouseId: whMain.id, qtyChange: -3, reason: "Cycle count — shortage" },
  });
  await prisma.stockAdjustment.create({
    data: { adjNo: "SA-00002", date: D("2026-05-16"), itemId: itemBySku.get("JWL-002")!.id, warehouseId: whMumbai.id, qtyChange: 5, reason: "Found stock — recount" },
  });

  // ── Warehouse transfers (internal — net-zero to total on-hand) ──────────────────────
  // TR-00001: 10 JWL-001 from Mumbai DC → Main (rebalance — JWL was received at Mumbai).
  await prisma.warehouseTransfer.create({
    data: {
      docNo: "TR-00001", date: D("2026-04-28"), itemId: itemBySku.get("JWL-001")!.id,
      fromWarehouseId: whMumbai.id, toWarehouseId: whMain.id, transferType: "SJIT", qty: 10,
    },
  });
  // TR-00002: 2 SAR-001 from Main → Mumbai DC (push some sarees to Mumbai).
  await prisma.warehouseTransfer.create({
    data: {
      docNo: "TR-00002", date: D("2026-05-14"), itemId: itemBySku.get("SAR-001")!.id,
      fromWarehouseId: whMain.id, toWarehouseId: whMumbai.id, transferType: "SOR", qty: 2,
    },
  });

  // ── Marketplace rates (commission % + logistics % per channel) ──────────────────────
  await prisma.marketplaceRate.createMany({
    data: [
      { marketplace: "Amazon", commissionPct: 15, logisticsPct: 6 },
      { marketplace: "Myntra", commissionPct: 18, logisticsPct: 5 },
      { marketplace: "Flipkart", commissionPct: 14, logisticsPct: 6 },
      { marketplace: "Nykaa", commissionPct: 20, logisticsPct: 7 },
    ],
  });

  // ── Marketplace orders (customer-side sale price + GST) — drives Margin Report ───────
  type MoSpec = { date: string; mkt: string; sku: string; type: "SALE" | "RETURN" | "RTO"; qty: number; price: number; pos?: string };
  const moSpecs: MoSpec[] = [
    { date: "2026-05-04", mkt: "Amazon", sku: "SAR-001", type: "SALE", qty: 5, price: 1899, pos: "Maharashtra" },
    { date: "2026-05-09", mkt: "Amazon", sku: "SAR-001", type: "RETURN", qty: 1, price: 1899, pos: "Maharashtra" },
    { date: "2026-05-06", mkt: "Myntra", sku: "KUR-002", type: "SALE", qty: 8, price: 1499, pos: HOME_STATE },
    { date: "2026-05-11", mkt: "Flipkart", sku: "KUR-001", type: "SALE", qty: 10, price: 999, pos: "Karnataka" },
    { date: "2026-05-13", mkt: "Nykaa", sku: "JWL-002", type: "SALE", qty: 6, price: 799, pos: "Delhi" },
    { date: "2026-05-15", mkt: "Amazon", sku: "SAR-003", type: "SALE", qty: 4, price: 1299, pos: "Gujarat" },
    { date: "2026-05-19", mkt: "Amazon", sku: "SAR-003", type: "RTO", qty: 1, price: 1299, pos: "Gujarat" },
  ];
  for (const m of moSpecs) {
    const it = itemBySku.get(m.sku)!;
    const taxable = m.qty * m.price;
    const gst = (taxable * it.tax) / 100;
    const interstate = (m.pos ?? HOME_STATE) !== HOME_STATE;
    await prisma.marketplaceOrder.create({
      data: {
        date: D(m.date), itemId: it.id, marketplace: m.mkt, type: m.type, placeOfSupply: m.pos ?? HOME_STATE,
        qty: m.qty, salePrice: m.price, taxableValue: taxable, gstRate: it.tax,
        cgst: interstate ? 0 : gst / 2, sgst: interstate ? 0 : gst / 2, igst: interstate ? gst : 0,
        total: taxable + gst,
      },
    });
  }

  // ── Marketing cost (per SKU per month) ───────────────────────────────────────────────
  const mc: { sku: string; month: string; amount: number }[] = [
    { sku: "SAR-001", month: "2026-05", amount: 1500 },
    { sku: "KUR-002", month: "2026-05", amount: 1200 },
    { sku: "KUR-001", month: "2026-05", amount: 900 },
    { sku: "JWL-002", month: "2026-05", amount: 600 },
    { sku: "SAR-003", month: "2026-05", amount: 500 },
  ];
  for (const m of mc) {
    await prisma.marketingCost.create({ data: { itemId: itemBySku.get(m.sku)!.id, month: m.month, amount: m.amount } });
  }

  // ── Reset doc-number series to continue after seeded docs ───────────────────────────
  const series = [
    { docType: "PO", prefix: "PO-", next: 5 },
    { docType: "GRN", prefix: "GRN-", next: 7 },
    { docType: "DN", prefix: "DN-", next: 2 },
    { docType: "CN", prefix: "CN-", next: 2 },
    { docType: "SA", prefix: "SA-", next: 3 },
    { docType: "TR", prefix: "TR-", next: 3 },
    { docType: "ORP", prefix: "ORP-", next: 2 },
  ];
  // Series are per-company since #134.
  const primary = await prisma.company.findFirst({ where: { isPrimary: true }, select: { id: true } });
  const cid = primary?.id ?? "";
  for (const s of series) {
    await prisma.series.upsert({
      where: { companyId_docType: { companyId: cid, docType: s.docType } },
      update: { nextNumber: s.next, prefix: s.prefix, padding: 5 },
      create: { companyId: cid, docType: s.docType, prefix: s.prefix, nextNumber: s.next, padding: 5 },
    });
  }

  // Single-company scope: stamp companyId = primary on every freshly-created
  // operational row. Without this the admin pages (which filter by companyId)
  // show nothing, while the vendorId-scoped portal shows everything.
  const stamped = await stampCompanyId(prisma);
  const stampedTotal = stamped.reduce((s, r) => s + r.count, 0);

  console.log("Demo data seeded:");
  console.log(`  companyId stamped on ${stampedTotal} rows (${stamped.length} tables) → primary company`);
  console.log("  4 active vendors (FTV/OR/FTV_NORETURN) + 1 pending, 8 items, 5 categories, 2 warehouses");
  console.log("  4 POs · 6 GRNs (PURCHASE/RTV/RFV) · 12 sales · FTV+OR payments · 2 Dr/Cr notes");
  console.log("  2 adjustments · 2 transfers · 4 marketplace rates · 7 marketplace orders · 5 marketing-cost rows");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
