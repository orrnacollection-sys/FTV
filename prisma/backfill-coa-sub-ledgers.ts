/**
 * #125 backfill — create CoA sub-ledger rows for existing Customer + Vendor
 * masters that pre-date the Accounting Engine. Idempotent: re-running finds
 * zero rows without a paired CoA and exits in seconds.
 *
 *   pnpm tsx prisma/backfill-coa-sub-ledgers.ts
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function nextChildCode(companyId: string, parentCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.chartOfAccount.findFirst({
    where: { companyId, code: { startsWith: `${parentCode}-` } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const prefix = `${parentCode}-`;
  const lastNum = last?.code ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String((lastNum || 0) + 1).padStart(3, "0")}`;
}

async function main() {
  // Backfill scopes to the primary company. Newly-created companies seed
  // their own CoA via seedCompanyForCreate() in companies/actions.ts.
  const primary = await prisma.company.findFirst({ where: { isPrimary: true }, select: { id: true } });
  if (!primary) {
    console.error("Primary company missing — run `pnpm tsx prisma/seed.ts` first.");
    process.exit(1);
  }
  const companyId = primary.id;
  const debtorsParent = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code: "1130" } },
    select: { id: true },
  });
  const creditorsParent = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code: "2110" } },
    select: { id: true },
  });
  if (!debtorsParent || !creditorsParent) {
    console.error("Standard CoA missing — run `pnpm tsx prisma/seed.ts` first.");
    process.exit(1);
  }

  // Customers
  const orphanCustomers = await prisma.customer.findMany({
    where: { ledger: null, companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`Customers without a CoA: ${orphanCustomers.length}`);
  let cCreated = 0;
  for (const c of orphanCustomers) {
    await prisma.$transaction(async (tx) => {
      const code = await nextChildCode(companyId, "1130", tx);
      await tx.chartOfAccount.create({
        data: {
          code, name: c.name, type: "ASSET", subType: "CURRENT_ASSET",
          parentId: debtorsParent.id, customerId: c.id, isSystem: true, companyId,
        },
      });
      console.log(`  + ${code.padEnd(10)} ${c.name}`);
    });
    cCreated++;
  }

  // Vendors
  const orphanVendors = await prisma.vendor.findMany({
    where: { ledger: null, companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`Vendors without a CoA:   ${orphanVendors.length}`);
  let vCreated = 0;
  for (const v of orphanVendors) {
    await prisma.$transaction(async (tx) => {
      const code = await nextChildCode(companyId, "2110", tx);
      await tx.chartOfAccount.create({
        data: {
          code, name: v.name, type: "LIABILITY", subType: "CURRENT_LIABILITY",
          parentId: creditorsParent.id, vendorId: v.id, isSystem: true, companyId,
        },
      });
      console.log(`  + ${code.padEnd(10)} ${v.name}`);
    });
    vCreated++;
  }

  console.log(`\nBackfill done. Customer sub-ledgers: ${cCreated}. Vendor sub-ledgers: ${vCreated}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
