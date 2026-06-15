/**
 * #126 backfill — auto-post journal entries for all existing Orders, GRNs,
 * and Payments that pre-date Phase 2 wiring. Idempotent: each helper
 * checks for an existing entry on (source, sourceRefId) before posting.
 *
 *   pnpm tsx prisma/backfill-accounting-phase-2.ts
 *
 * Logs but doesn't fail on any one-row error.
 */
import { PrismaClient } from "@prisma/client";
import { postSaleJournal, postGRNJournal, postPaymentJournal } from "../src/lib/accounting";

const prisma = new PrismaClient();

async function main() {
  // Orders
  const orders = await prisma.marketplaceOrder.findMany({
    select: { id: true },
    orderBy: { date: "asc" },
  });
  console.log(`Posting Sale JVs for ${orders.length} orders…`);
  let saleOk = 0, saleSkip = 0, saleErr = 0;
  for (const o of orders) {
    const r = await postSaleJournal(o.id);
    if ("ok" in r && r.ok) {
      if (r.skipped) saleSkip++; else saleOk++;
    } else { saleErr++; console.error(`  ✗ order ${o.id.slice(-8)}: ${r.error}`); }
  }
  console.log(`  → posted: ${saleOk} · skipped (already posted / zero): ${saleSkip} · errors: ${saleErr}`);

  // GRNs (non-draft)
  const grns = await prisma.gRN.findMany({
    where: { isDraft: false },
    select: { id: true },
    orderBy: { grnDate: "asc" },
  });
  console.log(`Posting Purchase JVs for ${grns.length} GRNs…`);
  let grnOk = 0, grnSkip = 0, grnErr = 0;
  for (const g of grns) {
    const r = await postGRNJournal(g.id);
    if ("ok" in r && r.ok) {
      if (r.skipped) grnSkip++; else grnOk++;
    } else { grnErr++; console.error(`  ✗ grn ${g.id.slice(-8)}: ${r.error}`); }
  }
  console.log(`  → posted: ${grnOk} · skipped: ${grnSkip} · errors: ${grnErr}`);

  // Payments (non-PENDING)
  const payments = await prisma.payment.findMany({
    where: { status: { not: "PENDING" } },
    select: { id: true },
    orderBy: { paidOn: "asc" },
  });
  console.log(`Posting Payment JVs for ${payments.length} payments…`);
  let payOk = 0, paySkip = 0, payErr = 0;
  for (const p of payments) {
    const r = await postPaymentJournal(p.id);
    if ("ok" in r && r.ok) {
      if (r.skipped) paySkip++; else payOk++;
    } else { payErr++; console.error(`  ✗ payment ${p.id.slice(-8)}: ${r.error}`); }
  }
  console.log(`  → posted: ${payOk} · skipped: ${paySkip} · errors: ${payErr}`);

  console.log(`\nBackfill done. New JVs: ${saleOk + grnOk + payOk}. Skipped: ${saleSkip + grnSkip + paySkip}. Errors: ${saleErr + grnErr + payErr}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
