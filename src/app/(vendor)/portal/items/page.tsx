import { requireVendor } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { VendorItemsTable } from "./VendorItemsTable";

export default async function VendorItemsPage() {
  const me = await requireVendor();
  const items = await prisma.item.findMany({
    where: { vendorId: me.vendorId },
    include: {
      vendor: { select: { model: true } },
      category: { select: { name: true } },
      priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = items.map((it) => {
    const latest = it.priceRevisions[0];
    return {
      id: it.id,
      imageUrl: it.imageUrl,
      skuCode: it.skuCode,
      name: it.name,
      hsn: it.hsn,
      model: latest?.model ?? it.vendor.model ?? null,
      category: it.category?.name ?? null,
      rate: latest?.transferPrice ?? null,
      taxRate: latest?.taxRate ?? null,
      effectiveDate: latest?.effectiveDate ?? null,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">My Items</h1>
        <p className="text-sm text-ink-faint">{rows.length} SKU{rows.length === 1 ? "" : "s"} · read-only</p>
      </div>
      <VendorItemsTable rows={rows} />
    </div>
  );
}
