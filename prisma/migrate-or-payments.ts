/**
 * One-off: move existing OR (ON_GRN) rows out of the month-based Payment table
 * into the new OrPayment voucher table, so the OR running ledger shows them.
 *
 *   npx tsx prisma/migrate-or-payments.ts
 *
 * Idempotent-ish: it deletes the migrated Payment rows, so re-running finds none.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const masters = await prisma.modelMaster.findMany({ select: { code: true, paymentBasis: true } });
  const onGrn = new Set(masters.filter((m) => m.paymentBasis === "ON_GRN").map((m) => m.code));
  onGrn.add("OR"); // safety fallback

  const orPays = await prisma.payment.findMany({
    where: { model: { in: [...onGrn] }, amountPaid: { gt: 0 } },
  });

  let moved = 0;
  for (const p of orPays) {
    await prisma.orPayment.create({
      data: {
        vendorId: p.vendorId,
        date: p.paidOn ?? p.createdAt,
        amount: p.amountPaid,
        reference: p.utr ?? null,
        particulars: `Migrated from ${p.month} payment`,
        createdBy: p.createdBy ?? null,
      },
    });
    await prisma.payment.delete({ where: { id: p.id } });
    moved++;
  }
  console.log(`Migrated ${moved} OR payment row(s) from Payment → OrPayment`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
