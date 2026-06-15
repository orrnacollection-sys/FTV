/**
 * One-shot backfill for #122: stamp Vendor.gstRegType based on whether
 * the row carries a GSTIN. Vendors WITH a GSTIN → REGULAR; without →
 * UNREGISTERED (which means RCM applies when we buy from them).
 *
 *   pnpm tsx prisma/backfill-vendor-gst-reg-type.ts
 *
 * Admin can refine to COMPOSITION / SEZ_UNIT / etc. later on the
 * Vendor form. Idempotent — only promotes rows still on the schema
 * default that have a GSTIN.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.vendor.findMany({
    where: { gstRegType: "UNREGISTERED", gst: { not: null } },
    select: { id: true, name: true, gst: true },
  });

  if (targets.length === 0) {
    console.log("No vendors need backfill — every GSTIN'd vendor already has a gstRegType.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Promoting ${targets.length} GSTIN-bearing vendor(s) → REGULAR…`);
  for (const v of targets) {
    await prisma.vendor.update({ where: { id: v.id }, data: { gstRegType: "REGULAR" } });
    console.log(`  ✎ ${v.name.padEnd(40)} ${v.gst}  → REGULAR`);
  }
  console.log(`\nBackfill done. ${targets.length} vendor(s) updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
