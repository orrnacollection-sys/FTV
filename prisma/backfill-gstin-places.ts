/**
 * One-time backfill for the Multi-GSTIN Places refactor.
 *
 *   pnpm tsx prisma/backfill-gstin-places.ts
 *
 * For every CompanyGSTIN row that doesn't already have any Places, this
 * creates one Place carrying the old single-address payload that used to
 * live directly on the GSTIN row (CompanyGSTIN.address, .placeType).
 *
 * Safe to run multiple times — it's keyed off "has any place under this
 * GSTIN" so a second run is a no-op. After this runs successfully, the
 * `address` and `placeType` columns on CompanyGSTIN can be dropped
 * (Phase C of the migration).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const gstins = await prisma.companyGSTIN.findMany({
    include: { places: { select: { id: true } }, company: { select: { brandName: true } } },
  });

  let created = 0;
  let skipped = 0;

  for (const g of gstins) {
    if (g.places.length > 0) {
      skipped++;
      continue;
    }

    // Read the transitional columns via a raw query — Prisma will hide
    // them once we drop them from the schema, but they still exist now.
    const row = await prisma.$queryRawUnsafe<
      Array<{ address: string | null; placeType: string | null }>
    >(
      `SELECT "address", "placeType" FROM "CompanyGSTIN" WHERE "id" = ?`,
      g.id,
    );
    const legacy = row[0] ?? { address: null, placeType: null };

    const placeType = legacy.placeType ?? "PPOB";
    const nickname =
      placeType === "PPOB"
        ? `${g.company.brandName ?? "Company"} HQ (${g.state})`
        : `${g.company.brandName ?? "Company"} branch (${g.state})`;

    await prisma.companyGSTINPlace.create({
      data: {
        gstinId: g.id,
        nickname,
        placeType,
        address: legacy.address,
        // city + pincode weren't tracked on the old row — left null,
        // admin can fill them from the Company Profile UI.
        isActive: true,
      },
    });
    created++;
    console.log(`  + Place for ${g.gstin} (${placeType}): ${nickname}`);
  }

  console.log(`\nBackfill done. Places created: ${created}. Already populated: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
