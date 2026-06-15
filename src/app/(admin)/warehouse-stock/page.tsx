import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveModels } from "@/lib/models";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { companyWhere } from "@/lib/scope";
import { WarehouseStockView } from "./WarehouseStockView";

export const dynamic = "force-dynamic";

const UNASSIGNED = "UNASSIGNED";

export default async function WarehouseStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vendorId?: string; model?: string; warehouseId?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const scope = await companyWhere();

  const itemWhere: Record<string, unknown> = { ...scope };
  if (q) itemWhere.OR = [{ skuCode: { contains: q } }, { name: { contains: q } }];
  if (sp.vendorId) itemWhere.vendorId = sp.vendorId;

  const [allItems, vendors, models, warehouses] = await Promise.all([
    prisma.item.findMany({
      where: itemWhere,
      select: {
        id: true,
        skuCode: true,
        name: true,
        vendor: { select: { code: true, name: true, model: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } },
      },
      orderBy: { skuCode: "asc" },
    }),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
    prisma.warehouse.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  // Model is resolved per-item from its latest price revision (falling back to the
  // vendor's dormant model for legacy data), then the model filter is applied here
  // rather than at the DB query level.
  const itemsWithModel = allItems.map((it) => ({
    ...it,
    resolvedModel: it.priceRevisions[0]?.model ?? it.vendor.model,
  }));
  const modelsWithData = [...new Set(itemsWithModel.map((it) => it.resolvedModel).filter((m): m is string => !!m))];
  const items = sp.model ? itemsWithModel.filter((it) => it.resolvedModel === sp.model) : itemsWithModel;

  const itemIds = items.map((i) => i.id);

  // Date-range filter (applied to each transaction's own date field).
  const from = sp.from ? parseFlexibleDate(sp.from) : null;
  const to = sp.to ? parseFlexibleDate(sp.to) : null;
  const dateCond =
    from || to
      ? { ...(from ? { gte: from } : {}), ...(to ? { lt: addDays(to, 1) } : {}) }
      : undefined;

  const [grnItems, sales, adjustments, transfers] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { itemId: { in: itemIds }, grn: { isDraft: false, ...(dateCond ? { grnDate: dateCond } : {}) } },
      select: { itemId: true, qty: true, rejectedQty: true, grn: { select: { type: true, warehouseId: true } } },
    }),
    prisma.sale.findMany({
      where: { itemId: { in: itemIds }, ...(dateCond ? { vchDate: dateCond } : {}) },
      select: { itemId: true, warehouseId: true, qtySold: true, qtyReturn: true, qtyRTO: true },
    }),
    prisma.stockAdjustment.findMany({
      where: { itemId: { in: itemIds }, ...(dateCond ? { date: dateCond } : {}) },
      select: { itemId: true, warehouseId: true, qtyChange: true },
    }),
    prisma.warehouseTransfer.findMany({
      where: {
        itemId: { in: itemIds },
        fromWarehouseId: { not: null },
        toWarehouseId: { not: null },
        ...(dateCond ? { date: dateCond } : {}),
      },
      select: { itemId: true, fromWarehouseId: true, toWarehouseId: true, qty: true },
    }),
  ]);

  // itemId -> (warehouseKey -> qty)
  const byItem = new Map<string, Map<string, number>>();
  const add = (itemId: string, whKey: string, delta: number) => {
    let m = byItem.get(itemId);
    if (!m) { m = new Map(); byItem.set(itemId, m); }
    m.set(whKey, (m.get(whKey) ?? 0) + delta);
  };
  for (const g of grnItems) {
    const accepted = g.qty - g.rejectedQty;
    // PURCHASE and RFV (Reject-In) both add stock; only RTV (Reject-Out) subtracts.
    add(g.itemId, g.grn.warehouseId ?? UNASSIGNED, g.grn.type === "RTV" ? -accepted : accepted);
  }
  for (const s of sales) {
    add(s.itemId, s.warehouseId ?? UNASSIGNED, -s.qtySold + s.qtyReturn + s.qtyRTO);
  }
  for (const a of adjustments) {
    add(a.itemId, a.warehouseId ?? UNASSIGNED, a.qtyChange);
  }
  // Transfers move qty between warehouses; net effect on total on-hand is zero.
  for (const t of transfers) {
    add(t.itemId, t.fromWarehouseId!, -t.qty);
    add(t.itemId, t.toWarehouseId!, t.qty);
  }

  // Columns: a single warehouse if filtered, else all warehouses + Unassigned.
  const anyUnassigned = [...byItem.values()].some((m) => (m.get(UNASSIGNED) ?? 0) !== 0);
  const columns = sp.warehouseId
    ? warehouses.filter((w) => w.id === sp.warehouseId).map((w) => ({ key: w.id, label: `${w.code} · ${w.name}` }))
    : [
        ...warehouses.map((w) => ({ key: w.id, label: `${w.code} · ${w.name}` })),
        ...(anyUnassigned ? [{ key: UNASSIGNED, label: "Unassigned" }] : []),
      ];

  const rows = items.map((it) => {
    const m = byItem.get(it.id) ?? new Map<string, number>();
    const perWarehouse: Record<string, number> = {};
    for (const c of columns) perWarehouse[c.key] = m.get(c.key) ?? 0;
    // Total is the full balance across ALL warehouses (matches the main Stock Report).
    let total = 0;
    for (const v of m.values()) total += v;
    return {
      id: it.id,
      skuCode: it.skuCode,
      name: it.name,
      vendor: `${it.vendor.code ?? "—"} · ${it.vendor.name}`,
      model: it.resolvedModel,
      perWarehouse,
      total,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Warehouse Stock</h1>
        <p className="text-sm text-ink-faint">
          Per-SKU balance by warehouse (GRN, RTV, Sales, Adjustments). Total matches the main Stock Report.
        </p>
      </div>
      <WarehouseStockView
        rows={rows}
        columns={columns}
        vendors={vendors}
        models={models}
        modelsWithData={modelsWithData}
        warehouses={warehouses}
        initial={{
          q: q ?? "",
          vendorId: sp.vendorId ?? "",
          model: sp.model ?? "",
          warehouseId: sp.warehouseId ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
