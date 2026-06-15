/**
 * Phase C of the Orders unification (#114-116).
 *
 *   pnpm tsx prisma/backfill-legacy-orders.ts
 *
 * Phase B linked existing Orders → Sales. This finishes the loop:
 *
 *   For every Sale row that STILL has sourceOrderId=null after Phase B,
 *   create a paired Order with channel="LEGACY" so the unified data
 *   model holds — going forward, every Sale row has an Order row, and
 *   admin only ever touches /orders.
 *
 * "LEGACY" channel marks these as pre-unification direct/manual entries.
 * Admins never pick it from the new-order form; it exists for the
 * backfill and historical reporting only.
 *
 * Money columns on the new Order are reconstructed from the Sale's
 * unitRate + qty + taxRate snapshot — Sale doesn't carry the CGST/SGST
 * split, so we recompute it as a 50/50 intra-state guess. That's
 * "good enough" for historical rows that nobody re-uses for compliance;
 * fresh data goes through the live import path with the proper split.
 *
 * Idempotent: re-running finds zero orphan Sales and exits in seconds.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orphans = await prisma.sale.findMany({
    where: { sourceOrderId: null },
    orderBy: { vchDate: "asc" },
    include: { item: { select: { skuCode: true } } },
  });

  if (orphans.length === 0) {
    console.log("No orphan Sales — every Sale already has a paired Order.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Backfilling ${orphans.length} legacy Sale(s) → channel=LEGACY Orders…`);

  let created = 0;
  let errors = 0;

  for (const sale of orphans) {
    try {
      // Derive Order.type + qty from whichever Sale qty column is non-zero.
      // If multiple are populated (rare — usually just one), pick the
      // largest as the dominant signal.
      let orderType: "SALE" | "RETURN" | "RTO" = "SALE";
      let qty = sale.qtySold;
      if (sale.qtyRTO > 0 && sale.qtyRTO >= sale.qtyReturn && sale.qtyRTO >= sale.qtySold) {
        orderType = "RTO";
        qty = sale.qtyRTO;
      } else if (sale.qtyReturn > 0 && sale.qtyReturn >= sale.qtySold) {
        orderType = "RETURN";
        qty = sale.qtyReturn;
      }

      // Money reconstruction — Sale carries unitRate + taxRate but not the
      // CGST/SGST/IGST split, so we synthesize a conservative 50/50
      // intra-state breakdown. (CESS isn't in scope here.)
      const taxableValue = qty * sale.unitRate;
      const gstAmount = (taxableValue * sale.taxRate) / 100;
      const cgst = Math.round((gstAmount / 2) * 100) / 100;
      const sgst = cgst;
      const igst = 0;
      const total = Math.round((taxableValue + cgst + sgst) * 100) / 100;

      await prisma.$transaction(async (tx) => {
        const order = await tx.marketplaceOrder.create({
          data: {
            date: sale.vchDate,
            itemId: sale.itemId,
            marketplace: sale.marketplace,
            channel: "LEGACY",
            type: orderType,
            placeOfSupply: null,
            warehouseId: sale.warehouseId,
            qty,
            salePrice: sale.unitRate,
            taxableValue: Math.round(taxableValue * 100) / 100,
            gstRate: sale.taxRate,
            cgst,
            sgst,
            igst,
            total,
            remarks: sale.manualRemarks
              ? `[migrated from Sale] ${sale.manualRemarks}`
              : "[migrated from Sale]",
            createdBy: sale.createdBy,
          },
        });
        await tx.sale.update({
          where: { id: sale.id },
          data: { sourceOrderId: order.id },
        });
      });
      created++;
      console.log(
        `  + Legacy Order for Sale ${sale.id.slice(-8)} ` +
        `(${sale.marketplace} · ${sale.item.skuCode} · ${orderType} ${qty})`,
      );
    } catch (e) {
      errors++;
      console.error(`  ✗ Sale ${sale.id.slice(-8)}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  console.log(`\nLegacy backfill done. Created: ${created}. Errors: ${errors}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
