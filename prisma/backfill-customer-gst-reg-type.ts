/**
 * One-shot backfill for #121: stamp Customer.gstRegType based on whether
 * the row carries a GSTIN. Customers WITH a GSTIN default to REGULAR
 * (the most common B2B case); customers WITHOUT default to UNREGISTERED.
 *
 *   pnpm tsx prisma/backfill-customer-gst-reg-type.ts
 *
 * Admin can refine to COMPOSITION / SEZ_UNIT / SEZ_DEVELOPER / UIN_HOLDER
 * later on the Customer form. Idempotent — only touches rows whose
 * current value is the schema default ("UNREGISTERED") AND that have a
 * GSTIN, so re-runs after manual edits don't undo them.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.customer.findMany({
    where: { gstRegType: "UNREGISTERED", gst: { not: null } },
    select: { id: true, name: true, gst: true },
  });

  if (targets.length === 0) {
    console.log("No customers need backfill — every GSTIN'd customer already has a gstRegType.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Promoting ${targets.length} GSTIN-bearing customer(s) → REGULAR…`);
  for (const c of targets) {
    await prisma.customer.update({ where: { id: c.id }, data: { gstRegType: "REGULAR" } });
    console.log(`  ✎ ${c.name.padEnd(40)} ${c.gst}  → REGULAR`);
  }
  console.log(`\nBackfill done. ${targets.length} customer(s) updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
