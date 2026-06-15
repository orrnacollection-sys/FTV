/**
 * Phase B of the Orders unification (#114-115).
 *
 *   pnpm tsx prisma/backfill-order-sale-links.ts
 *
 * For every MarketplaceOrder row that has no paired Sale yet, try to find
 * a pre-existing Sale that matches on date+SKU+marketplace+qty and link
 * them via Sale.sourceOrderId. Orders with no match get a freshly-created
 * Sale row via the same projection logic the live import uses.
 *
 * Match rules (conservative — we'd rather create a new Sale than mis-link):
 *   1. Sale.sourceOrderId IS NULL (not already linked)
 *   2. Sale.itemId == Order.itemId
 *   3. Sale.vchDate is on the same calendar day as Order.date
 *   4. Sale.marketplace == Order.marketplace (case-insensitive)
 *   5. The qty column that matches Order.type carries Order.qty exactly:
 *        SALE   → Sale.qtySold   == Order.qty
 *        RETURN → Sale.qtyReturn == Order.qty
 *        RTO    → Sale.qtyRTO    == Order.qty
 *
 * Multiple candidates → oldest Sale.createdAt wins (so the first manual
 * entry gets linked, not the most recent). One Sale can never be claimed
 * by two Orders because step 1 excludes already-linked rows.
 *
 * Idempotent: re-running finds zero orphan Orders and exits in seconds.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Same projection as src/lib/order-sale-sync.ts qtyColumnsForType. */
function qtyColumnsForType(orderType: string, qty: number) {
  if (orderType === "RETURN") {
    return { transactionType: "RETURN", qtySold: 0, qtyReturn: qty, qtyRTO: 0 };
  }
  if (orderType === "RTO") {
    return { transactionType: "RETURN", qtySold: 0, qtyReturn: 0, qtyRTO: qty };
  }
  return { transactionType: "SALE", qtySold: qty, qtyReturn: 0, qtyRTO: 0 };
}

async function resolveModelAtDate(itemId: string, date: Date): Promise<string | null> {
  const rev = await prisma.itemPriceRevision.findFirst({
    where: { itemId, effectiveDate: { lte: date } },
    orderBy: { effectiveDate: "desc" },
    select: { model: true },
  });
  return rev?.model ?? null;
}

async function main() {
  const orphanOrders = await prisma.marketplaceOrder.findMany({
    where: { sale: null },
    orderBy: { date: "asc" },
    include: { item: { select: { vendorId: true, skuCode: true } } },
  });

  if (orphanOrders.length === 0) {
    console.log("No orphan Orders — Phase A already paired everything.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Scanning ${orphanOrders.length} orphan Order(s)…`);

  let linked = 0;
  let created = 0;
  let errors = 0;

  for (const order of orphanOrders) {
    const dayStart = new Date(order.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Fetch candidate Sales for this day+item then filter in JS — SQLite
    // doesn't support Prisma's `mode: insensitive` so we lowercase here.
    const candidates = await prisma.sale.findMany({
      where: {
        sourceOrderId: null,
        itemId: order.itemId,
        vchDate: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { createdAt: "asc" },
    });
    const mpKey = order.marketplace.trim().toLowerCase();
    const candidate = candidates.find((s) => {
      if (s.marketplace.trim().toLowerCase() !== mpKey) return false;
      if (order.type === "RETURN") return s.qtyReturn === order.qty;
      if (order.type === "RTO") return s.qtyRTO === order.qty;
      return s.qtySold === order.qty;
    });

    try {
      if (candidate) {
        await prisma.sale.update({
          where: { id: candidate.id },
          data: { sourceOrderId: order.id },
        });
        linked++;
        console.log(
          `  ↪ Linked Order ${order.id.slice(-8)} → Sale ${candidate.id.slice(-8)} ` +
          `(${order.marketplace} · ${order.item.skuCode} · ${order.type} ${order.qty})`,
        );
      } else {
        // No match — create a paired Sale using the same projection the
        // live importer uses.
        const qtyCols = qtyColumnsForType(order.type, order.qty);
        const model = await resolveModelAtDate(order.itemId, order.date);
        await prisma.sale.create({
          data: {
            vchDate: order.date,
            marketplace: order.marketplace,
            itemId: order.itemId,
            vendorId: order.item.vendorId,
            warehouseId: order.warehouseId,
            transactionType: qtyCols.transactionType,
            model,
            qtySold: qtyCols.qtySold,
            qtyReturn: qtyCols.qtyReturn,
            qtyRTO: qtyCols.qtyRTO,
            unitRate: order.salePrice,
            taxRate: order.gstRate,
            manualRemarks: order.remarks,
            sourceOrderId: order.id,
            createdBy: order.createdBy,
          },
        });
        created++;
        console.log(
          `  + Created Sale for Order ${order.id.slice(-8)} ` +
          `(${order.marketplace} · ${order.item.skuCode} · ${order.type} ${order.qty})`,
        );
      }
    } catch (e) {
      errors++;
      console.error(`  ✗ Order ${order.id.slice(-8)}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  console.log(`\nBackfill done. Linked: ${linked}. Created: ${created}. Errors: ${errors}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
