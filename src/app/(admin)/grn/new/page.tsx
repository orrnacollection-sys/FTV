import { prisma } from "@/lib/db";
import { GRNBuilder } from "../GRNBuilder";

export default async function NewGRNPage() {
  const vendors = await prisma.vendor.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
  const warehouses = await prisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const items = await prisma.item.findMany({
    where: { itemType: { not: "SERVICE" } }, // services are billing-only — not receivable into stock
    orderBy: { name: "asc" },
    include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  const itemRows = items.map((it) => ({
    id: it.id,
    skuCode: it.skuCode,
    name: it.name,
    vendorId: it.vendorId,
    latestRate: it.priceRevisions[0]?.transferPrice ?? 0,
    latestTax: it.priceRevisions[0]?.taxRate ?? 0,
  }));

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-3xl font-bold">New GRN</h1>
      <p className="text-sm text-ink-faint mb-6">Batch number and expiry (GRN date + 120 days) are auto-assigned per row.</p>
      <GRNBuilder vendors={vendors} items={itemRows} warehouses={warehouses} />
    </div>
  );
}
