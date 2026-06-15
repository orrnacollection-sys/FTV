import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const charges = await prisma.otherCharge.findMany({
    where: { model: null },
    select: { id: true, vendor: { select: { model: true } } },
  });
  let n = 0;
  for (const c of charges) {
    if (!c.vendor.model) continue;
    await prisma.otherCharge.update({ where: { id: c.id }, data: { model: c.vendor.model } });
    n++;
  }
  console.log(`Backfilled model on ${n} other-charge row(s) (direction defaults to DEBIT)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
