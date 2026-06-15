import { prisma } from "@/lib/db";
import { GRNBuilder } from "../../grn/GRNBuilder";

export default async function NewRtvPage() {
  const vendors = await prisma.vendor.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
  const warehouses = await prisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const items = await prisma.item.findMany({
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
      <h1 className="font-display text-3xl font-bold">New RTV (Reject Out)</h1>
      <p className="text-sm text-ink-faint mb-6">
        Return purchased goods to the vendor. This reduces inventory and posts a debit to the vendor ledger.
      </p>
      <GRNBuilder vendors={vendors} items={itemRows} warehouses={warehouses} initialType="RTV" returnTo="/rtv" />
    </div>
  );
}
