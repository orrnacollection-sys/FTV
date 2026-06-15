import { prisma } from "@/lib/db";
import { POBuilder } from "../POBuilder";

export default async function NewPOPage() {
  const vendors = await prisma.vendor.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
  const items = await prisma.item.findMany({
    orderBy: { name: "asc" },
    include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  const itemRows = items.map((it) => ({
    id: it.id,
    skuCode: it.skuCode,
    name: it.name,
    hsn: it.hsn,
    vendorId: it.vendorId,
    imageUrl: it.imageUrl,
    latestRate: it.priceRevisions[0]?.transferPrice ?? 0,
    latestTax: it.priceRevisions[0]?.taxRate ?? 0,
  }));

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl font-bold">New Purchase Order</h1>
      <p className="text-sm text-ink-faint mb-6">PO number is generated on save.</p>
      {vendors.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You need at least one active vendor.
        </div>
      ) : (
        <POBuilder vendors={vendors} items={itemRows} />
      )}
    </div>
  );
}
