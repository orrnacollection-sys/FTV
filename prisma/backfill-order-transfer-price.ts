/**
 * Backfill Order.transferPrice for rows created before #117.
 *
 *   pnpm tsx prisma/backfill-order-transfer-price.ts
 *
 * For every MarketplaceOrder row with transferPrice = 0, resolve the
 * effective ItemPriceRevision at order.date and stamp it onto the row.
 *
 *   Order.transferPrice = max(0, ItemPriceRevision(at order.date).transferPrice)
 *
 * No vendor-payout query reads from this column yet (that's Step 2 of
 * the rollout). So this backfill purely populates the display mirror;
 * vendor payments don't change.
 *
 * Idempotent — re-running finds zero zero-rows and exits in seconds.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.marketplaceOrder.findMany({
    where: { transferPrice: 0 },
    select: { id: true, itemId: true, date: true },
    orderBy: { date: "asc" },
  });

  if (targets.length === 0) {
    console.log("No orders with transferPrice=0 — nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Backfilling transferPrice on ${targets.length} order(s)…`);

  let stamped = 0;
  let unresolved = 0;

  for (const o of targets) {
    const rev = await prisma.itemPriceRevision.findFirst({
      where: { itemId: o.itemId, effectiveDate: { lte: o.date } },
      orderBy: { effectiveDate: "desc" },
      select: { transferPrice: true },
    });
    if (!rev) {
      unresolved++;
      console.log(`  ? Order ${o.id.slice(-8)}: no ItemPriceRevision at ${o.date.toISOString().slice(0, 10)}`);
      continue;
    }
    await prisma.marketplaceOrder.update({
      where: { id: o.id },
      data: { transferPrice: rev.transferPrice },
    });
    stamped++;
  }

  console.log(`\nBackfill done. Stamped: ${stamped}. Unresolved (no revision): ${unresolved}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
