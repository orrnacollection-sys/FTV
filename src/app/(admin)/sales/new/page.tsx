import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { RecordSaleForm } from "./RecordSaleForm";

export default async function NewSalePage() {
  await requireAdmin();
  const [items, warehouses] = await Promise.all([
    prisma.item.findMany({
      orderBy: { skuCode: "asc" },
      include: {
        vendor: { select: { name: true, code: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 },
      },
    }),
    prisma.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const itemRows = items.map((it) => ({
    id: it.id,
    skuCode: it.skuCode,
    name: it.name,
    vendor: `${it.vendor.code ?? ""} · ${it.vendor.name}`,
    latestRate: it.priceRevisions[0]?.transferPrice ?? 0,
    latestTax: it.priceRevisions[0]?.taxRate ?? 0,
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-bold">Record Sale</h1>
      <p className="text-sm text-ink-faint mb-6">
        Rate &amp; tax are pulled from Item Master based on the voucher date.
      </p>
      {itemRows.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No items yet — create an item first.
        </div>
      ) : (
        <RecordSaleForm items={itemRows} warehouses={warehouses} />
      )}
    </div>
  );
}
