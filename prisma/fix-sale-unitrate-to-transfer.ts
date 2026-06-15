/**
 * One-shot data fix for the Phase A regression (#114) where
 * `Sale.unitRate` was momentarily set to `order.salePrice` (customer side)
 * instead of `order.transferPrice` (vendor side).
 *
 *   pnpm tsx prisma/fix-sale-unitrate-to-transfer.ts
 *
 * Why this matters: Sale.unitRate is shared with vendors via the portal
 * (/portal/sales) as the line-level payable amount. If it carried the
 * customer-facing sale price, vendors would see what we sold to customers
 * at — confidential commercial info that mustn't leak.
 *
 * Strategy: for every Sale row with a sourceOrderId, set
 *   Sale.unitRate ← sourceOrder.transferPrice
 *
 * Sale rows without a sourceOrderId (legacy direct entries pre-unification)
 * are NOT touched — they were already populated with the vendor side at
 * /sales/new manual entry time.
 *
 * Idempotent: re-running finds zero rows where unitRate ≠ transferPrice
 * and exits in seconds.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const linked = await prisma.sale.findMany({
    where: { sourceOrderId: { not: null } },
    include: {
      sourceOrder: { select: { transferPrice: true, salePrice: true } },
    },
  });

  if (linked.length === 0) {
    console.log("No linked Sales — nothing to fix.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Auditing ${linked.length} linked Sale row(s)…`);

  let fixed = 0;
  let alreadyCorrect = 0;
  for (const s of linked) {
    const target = s.sourceOrder?.transferPrice ?? 0;
    if (s.unitRate === target) {
      alreadyCorrect++;
      continue;
    }
    await prisma.sale.update({
      where: { id: s.id },
      data: { unitRate: target },
    });
    fixed++;
    console.log(
      `  ✎ Sale ${s.id.slice(-8)}: unitRate ₹${s.unitRate.toFixed(2)} → ₹${target.toFixed(2)}` +
      ` (was tracking salePrice ₹${(s.sourceOrder?.salePrice ?? 0).toFixed(2)})`,
    );
  }

  console.log(`\nFix done. Corrected: ${fixed}. Already correct: ${alreadyCorrect}.`);
  console.log(`Sale.unitRate now uniformly represents the VENDOR-side transfer price.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
