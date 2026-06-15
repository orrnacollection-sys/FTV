#!/usr/bin/env node
/**
 * Backfill `companyId` on every operational row to the primary Company.
 * One-shot — idempotent (already-set rows are left alone).
 *
 *   node prisma/backfill-company-id.mjs
 *
 * Run after `add-company-id.mjs` + `prisma db push`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TABLES = [
  "vendor",
  "category",
  "item",
  "warehouse",
  "customer",
  "purchaseOrder",
  "gRN",
  "sale",
  "payment",
  "warehouseTransfer",
  "otherCharge",
  "stockAdjustment",
  "orPayment",
  "marketplaceOrder",
  "marketingCost",
  "marketplaceRate",
  "series",
  "chartOfAccount",
  "journalEntry",
  "bankAccount",
  "bankTransaction",
];

async function main() {
  const primary = await prisma.company.findFirst({
    where: { isPrimary: true },
    select: { id: true, brandName: true },
  });
  if (!primary) {
    console.error("No primary Company row — run `prisma seed` first.");
    process.exit(1);
  }
  console.log(`Backfilling all operational rows to: ${primary.brandName} (${primary.id})\n`);

  let totalUpdated = 0;
  for (const table of TABLES) {
    const model = prisma[table];
    if (!model) {
      console.warn(`  ! Unknown model ${table} — skipping`);
      continue;
    }
    const r = await model.updateMany({
      where: { companyId: null },
      data: { companyId: primary.id },
    });
    console.log(`  + ${table.padEnd(22)} ${r.count}`);
    totalUpdated += r.count;
  }
  console.log(`\nUpdated ${totalUpdated} rows across ${TABLES.length} tables.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
