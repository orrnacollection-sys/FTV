import { prisma } from "@/lib/db";
import { GRNBuilder } from "../../grn/GRNBuilder";

export default async function NewRfvPage() {
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
      <h1 className="font-display text-3xl font-bold">New RFV (Reject-In)</h1>
      <p className="text-sm text-ink-faint mb-6">
        Goods received back from the vendor. This increases inventory; for OR it credits the vendor ledger (due in term days). FTV is stock-only.
      </p>
      <GRNBuilder vendors={vendors} items={itemRows} warehouses={warehouses} initialType="RFV" returnTo="/rfv" />
    </div>
  );
}
