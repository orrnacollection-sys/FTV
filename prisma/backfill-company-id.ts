/**
 * One-time backfill — stamp companyId = primary on every NULL operational row.
 *
 *   npx tsx prisma/backfill-company-id.ts
 *
 * Fixes the "admin lists empty but vendor portal shows data" mismatch: demo /
 * legacy rows were created without a companyId, so the company-scoped admin
 * queries hid them. Only the companyId tag is written — math is untouched.
 * Idempotent.
 */
import { PrismaClient } from "@prisma/client";
import { stampCompanyId } from "./_stamp-company";

const prisma = new PrismaClient();

async function main() {
  const results = await stampCompanyId(prisma);
  if (results.length === 0) {
    console.log("Nothing to backfill — all operational rows already scoped.");
    return;
  }
  console.log("Stamped companyId on:");
  for (const r of results) console.log(`  ${r.model}: ${r.count}`);
  console.log(`Total tables touched: ${results.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
