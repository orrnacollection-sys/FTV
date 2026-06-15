import { requireVendor } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { VendorInventoryView } from "./VendorInventoryView";

export const dynamic = "force-dynamic";

/**
 * Vendor-facing inventory report — the admin Stock Report format, scoped to the
 * signed-in vendor's own SKUs. Balance = Net Inward − Sale + Return + RTO + Adj.
 * Read-only: no Vendor column / filter (they only ever see their own), and rows
 * don't drill into the admin Stock Ledger.
 */
export default async function VendorInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; model?: string }>;
}) {
  const me = await requireVendor();
  const sp = await searchParams;
  const q = sp.q?.trim();

  const itemWhere: Record<string, unknown> = { vendorId: me.vendorId, itemType: { not: "SERVICE" } };
  if (q) itemWhere.OR = [{ skuCode: { contains: q } }, { name: { contains: q } }];

  const [items, models] = await Promise.all([
    prisma.item.findMany({
      where: itemWhere,
      select: {
        id: true,
        skuCode: true,
        name: true,
        vendor: { select: { model: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } },
      },
      orderBy: { skuCode: "asc" },
    }),
    getActiveModels(),
  ]);

  const itemIds = items.map((i) => i.id);

  // Inward split (Purchase / RTV / RFV) from non-draft GRNs touching these SKUs.
  const grnDetail = await prisma.gRNItem.findMany({
    where: { itemId: { in: itemIds }, grn: { isDraft: false } },
    select: { itemId: true, qty: true, rejectedQty: true, grn: { select: { type: true } } },
  });
  const inwardMap = new Map<string, { purchase: number; rtv: number; rfv: number }>();
  for (const r of grnDetail) {
    const accepted = r.qty - r.rejectedQty;
    const e = inwardMap.get(r.itemId) ?? { purchase: 0, rtv: 0, rfv: 0 };
    if (r.grn.type === "PURCHASE") e.purchase += accepted;
    else if (r.grn.type === "RTV") e.rtv += accepted;
    else e.rfv += accepted; // RFV (Reject-In) adds back to stock
    inwardMap.set(r.itemId, e);
  }

  const saleAggs = await prisma.sale.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds } },
    _sum: { qtySold: true, qtyReturn: true, qtyRTO: true },
  });
  const salesMap = new Map(saleAggs.map((s) => [s.itemId, {
    sold: s._sum.qtySold ?? 0,
    ret: s._sum.qtyReturn ?? 0,
    rto: s._sum.qtyRTO ?? 0,
  }]));

  const adjAggs = await prisma.stockAdjustment.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds } },
    _sum: { qtyChange: true },
  });
  const adjMap = new Map(adjAggs.map((a) => [a.itemId, a._sum.qtyChange ?? 0]));

  const allRows = items.map((it) => {
    const inward = inwardMap.get(it.id) ?? { purchase: 0, rtv: 0, rfv: 0 };
    const sales = salesMap.get(it.id) ?? { sold: 0, ret: 0, rto: 0 };
    const adj = adjMap.get(it.id) ?? 0;
    const netInward = inward.purchase + inward.rfv - inward.rtv;
    const balance = netInward - sales.sold + sales.ret + sales.rto + adj;
    return {
      id: it.id,
      skuCode: it.skuCode,
      name: it.name,
      model: it.priceRevisions[0]?.model ?? it.vendor.model,
      purchaseQty: inward.purchase,
      rtvQty: inward.rtv,
      rfvQty: inward.rfv,
      netInward,
      sale: sales.sold,
      ret: sales.ret,
      rto: sales.rto,
      adj,
      balance,
    };
  });

  const modelsWithData = [...new Set(allRows.map((r) => r.model).filter((m): m is string => !!m))];
  const rows = sp.model ? allRows.filter((r) => r.model === sp.model) : allRows;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Inventory</h1>
        <p className="text-sm text-ink-faint">
          {rows.length} SKU{rows.length === 1 ? "" : "s"} · Balance = Net Inward − Sale + Return + RTO + Adjustments · read-only
        </p>
      </div>
      <VendorInventoryView
        rows={rows}
        models={models}
        modelsWithData={modelsWithData}
        initial={{ q: q ?? "", model: sp.model ?? "" }}
      />
    </div>
  );
}
