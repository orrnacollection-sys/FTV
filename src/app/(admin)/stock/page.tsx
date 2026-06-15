import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { companyWhere } from "@/lib/scope";
import { StockReportView } from "./StockReportView";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vendorId?: string; model?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const scope = await companyWhere();

  const itemWhere: Record<string, unknown> = { ...scope, itemType: { not: "SERVICE" } };
  if (q) itemWhere.OR = [{ skuCode: { contains: q } }, { name: { contains: q } }];
  if (sp.vendorId) itemWhere.vendorId = sp.vendorId;

  const [items, vendors, models] = await Promise.all([
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
  ]);

  // Purchase / RTV / RFV split — single query joining to GRN type.
  // Scope via the parent GRN's companyId (GRNItem has no companyId of its own).
  const grnDetail = await prisma.gRNItem.findMany({
    where: { grn: { ...scope, isDraft: false } },
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
    where: scope,
    _sum: { qtySold: true, qtyReturn: true, qtyRTO: true },
  });
  const salesMap = new Map(saleAggs.map((s) => [s.itemId, {
    sold: s._sum.qtySold ?? 0,
    ret: s._sum.qtyReturn ?? 0,
    rto: s._sum.qtyRTO ?? 0,
  }]));

  const adjAggs = await prisma.stockAdjustment.groupBy({
    by: ["itemId"],
    where: scope,
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
      vendor: `${it.vendor.code ?? "—"} · ${it.vendor.name}`,
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

  // Model is now resolved per-item from its latest price revision, so the model
  // filter is applied post-computation rather than at the DB query level.
  const modelsWithData = [...new Set(allRows.map((r) => r.model).filter((m): m is string => !!m))];
  const rows = sp.model ? allRows.filter((r) => r.model === sp.model) : allRows;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Stock Report</h1>
        <p className="text-sm text-ink-faint">Balance = Net Inward − Sale + Return + RTO + Adjustments</p>
      </div>
      <StockReportView
        rows={rows}
        vendors={vendors}
        models={models}
        modelsWithData={modelsWithData}
        initial={{ q: q ?? "", vendorId: sp.vendorId ?? "", model: sp.model ?? "" }}
      />
    </div>
  );
}
