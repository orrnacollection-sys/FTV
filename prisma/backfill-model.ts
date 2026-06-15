/**
 * One-off backfill for the multi-model redesign (Phase A1).
 *
 *   npx tsx prisma/backfill-model.ts
 *
 * - Stamps existing ItemPriceRevision / Sale / GRNItem rows that have no model
 *   with the item's current vendor model (the authoritative model before this
 *   change lived on Vendor.model).
 * - Sets ModelMaster payment rules: OR → ON_GRN / 45 days; everything else → ON_SALE / 0.
 *
 * Idempotent: only touches rows where model is still null, and re-applying the
 * ModelMaster rules is a no-op.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Map itemId -> vendor model (the pre-change source of truth).
  const items = await prisma.item.findMany({
    select: { id: true, vendor: { select: { model: true } } },
  });
  const modelByItem = new Map(items.map((i) => [i.id, i.vendor.model ?? null]));

  let revs = 0;
  for (const [itemId, model] of modelByItem) {
    if (!model) continue;
    const r = await prisma.itemPriceRevision.updateMany({
      where: { itemId, model: null },
      data: { model },
    });
    revs += r.count;
  }

  let sales = 0;
  for (const [itemId, model] of modelByItem) {
    if (!model) continue;
    const r = await prisma.sale.updateMany({ where: { itemId, model: null }, data: { model } });
    sales += r.count;
  }

  let grnLines = 0;
  for (const [itemId, model] of modelByItem) {
    if (!model) continue;
    const r = await prisma.gRNItem.updateMany({ where: { itemId, model: null }, data: { model } });
    grnLines += r.count;
  }

  // Payment rules per model.
  await prisma.modelMaster.updateMany({ where: { code: "OR" }, data: { paymentBasis: "ON_GRN", paymentTermDays: 45 } });
  await prisma.modelMaster.updateMany({ where: { code: { in: ["FTV", "FTV_NORETURN"] } }, data: { paymentBasis: "ON_SALE", paymentTermDays: 0 } });

  console.log(`Backfilled model → ${revs} price revisions, ${sales} sales, ${grnLines} GRN lines`);
  console.log("ModelMaster payment rules applied (OR=ON_GRN/45, FTV & FTV_NORETURN=ON_SALE/0)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
