import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { companyWhere } from "@/lib/scope";
import { StockAdjustmentsPanel } from "./StockAdjustmentsPanel";

export const dynamic = "force-dynamic";

export default async function StockAdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warehouseId?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const where: Record<string, unknown> = { ...scope };
  if (sp.warehouseId) where.warehouseId = sp.warehouseId;
  if (sp.q) where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.date = d;
  }

  const [adjustments, items, warehouses] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      include: {
        item: { select: { skuCode: true, name: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 1000,
    }),
    prisma.item.findMany({ where: scope, orderBy: { skuCode: "asc" }, select: { id: true, skuCode: true, name: true } }),
    prisma.warehouse.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const rows = adjustments.map((a) => ({
    id: a.id,
    adjNo: a.adjNo,
    date: a.date,
    skuCode: a.item.skuCode,
    itemName: a.item.name,
    warehouse: a.warehouse ? `${a.warehouse.code} · ${a.warehouse.name}` : null,
    qtyChange: a.qtyChange,
    reason: a.reason,
    notes: a.notes,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Stock Adjustment</h1>
        <p className="text-sm text-ink-faint">
          Manual +/- inventory corrections (physical vs system). Flows into the Stock Report balance.
        </p>
      </div>
      <StockAdjustmentsPanel
        rows={rows}
        items={items}
        warehouses={warehouses}
        initial={{
          q: sp.q ?? "",
          warehouseId: sp.warehouseId ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
