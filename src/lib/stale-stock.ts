import { prisma } from "@/lib/db";

/**
 * Stale Stock — surfaces SKUs whose oldest unsold inventory has aged past the
 * vendor's tolerance window. Drives the "settle by RTV" workflow that closes
 * out vendor liabilities under the new legal-ledger view.
 *
 * Per SKU:
 *  1. Build FIFO layers from PURCHASE + RFV GRN lines (accepted qty, by date).
 *  2. Consume layers oldest-first by net sales (sold − return − RTO) + RTV qty
 *     + any negative stock adjustments. What remains is the on-hand stock,
 *     distributed across its original receipt batches.
 *  3. Within the remaining layers, qty in layers older than vendor.staleDays
 *     (fallback DEFAULT_STALE_DAYS) is "stale" — a candidate for RTV.
 */

export const DEFAULT_STALE_DAYS = 120;

export type StaleLayer = {
  grnId: string;
  grnNo: string;
  date: Date;
  ageDays: number;
  qty: number;
  rate: number;
};

export type StaleStockRow = {
  itemId: string;
  skuCode: string;
  itemName: string;
  vendorId: string;
  vendorCode: string | null;
  vendorName: string;
  model: string | null;
  thresholdDays: number;
  oldestDate: Date;
  oldestAgeDays: number;
  staleQty: number;
  staleValue: number;
  totalOnHand: number;
  layers: StaleLayer[];
};

export async function buildStaleStock(opts: {
  companyId: string;
  vendorId?: string;
  model?: string;
}): Promise<{ rows: StaleStockRow[]; defaultDays: number; totalStaleValue: number }> {
  const today = new Date();
  const todayMs = today.getTime();
  const { companyId } = opts;

  const itemWhere: Record<string, unknown> = { companyId };
  if (opts.vendorId) itemWhere.vendorId = opts.vendorId;

  const items = await prisma.item.findMany({
    where: itemWhere,
    select: {
      id: true, skuCode: true, name: true,
      vendor: { select: { id: true, code: true, name: true, staleDays: true, model: true } },
      priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } },
    },
  });

  const itemIds = items.map((i) => i.id);
  if (itemIds.length === 0) return { rows: [], defaultDays: DEFAULT_STALE_DAYS, totalStaleValue: 0 };

  const [purchaseLines, rtvLines, salesAgg, adjAgg] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { itemId: { in: itemIds }, grn: { type: { in: ["PURCHASE", "RFV"] }, isDraft: false } },
      select: { itemId: true, qty: true, rejectedQty: true, rate: true, grn: { select: { id: true, grnNo: true, grnDate: true } } },
    }),
    prisma.gRNItem.findMany({
      where: { itemId: { in: itemIds }, grn: { type: "RTV", isDraft: false } },
      select: { itemId: true, qty: true, rejectedQty: true },
    }),
    prisma.sale.groupBy({ by: ["itemId"], where: { itemId: { in: itemIds } }, _sum: { qtySold: true, qtyReturn: true, qtyRTO: true } }),
    prisma.stockAdjustment.groupBy({ by: ["itemId"], where: { itemId: { in: itemIds } }, _sum: { qtyChange: true } }),
  ]);

  const layersByItem = new Map<string, { grnId: string; grnNo: string; date: Date; qty: number; rate: number }[]>();
  for (const g of purchaseLines) {
    const accepted = g.qty - g.rejectedQty;
    if (accepted <= 0) continue;
    const arr = layersByItem.get(g.itemId) ?? [];
    arr.push({ grnId: g.grn.id, grnNo: g.grn.grnNo, date: g.grn.grnDate, qty: accepted, rate: g.rate });
    layersByItem.set(g.itemId, arr);
  }
  for (const arr of layersByItem.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  const netSaleByItem = new Map(
    salesAgg.map((s) => [s.itemId, Math.max(0, (s._sum.qtySold ?? 0) - (s._sum.qtyReturn ?? 0) - (s._sum.qtyRTO ?? 0))]),
  );
  const rtvByItem = new Map<string, number>();
  for (const r of rtvLines) {
    const accepted = r.qty - r.rejectedQty;
    rtvByItem.set(r.itemId, (rtvByItem.get(r.itemId) ?? 0) + accepted);
  }
  const negAdjByItem = new Map(
    adjAgg
      .filter((a) => (a._sum.qtyChange ?? 0) < 0)
      .map((a) => [a.itemId, -(a._sum.qtyChange ?? 0)]),
  );

  const rows: StaleStockRow[] = [];
  for (const it of items) {
    const layers = layersByItem.get(it.id);
    if (!layers || layers.length === 0) continue;

    let consume = (netSaleByItem.get(it.id) ?? 0) + (rtvByItem.get(it.id) ?? 0) + (negAdjByItem.get(it.id) ?? 0);

    const remaining: StaleLayer[] = [];
    for (const l of layers) {
      if (consume >= l.qty) { consume -= l.qty; continue; }
      const remQty = l.qty - consume;
      consume = 0;
      const ageDays = Math.floor((todayMs - l.date.getTime()) / 86_400_000);
      remaining.push({ grnId: l.grnId, grnNo: l.grnNo, date: l.date, ageDays, qty: remQty, rate: l.rate });
    }
    if (remaining.length === 0) continue;

    const model = it.priceRevisions[0]?.model ?? it.vendor.model;
    if (opts?.model && model !== opts.model) continue;

    const threshold = it.vendor.staleDays ?? DEFAULT_STALE_DAYS;
    let staleQty = 0;
    let staleValue = 0;
    for (const l of remaining) {
      if (l.ageDays >= threshold) {
        staleQty += l.qty;
        staleValue += l.qty * l.rate;
      }
    }
    if (staleQty <= 0) continue;

    const oldest = remaining[0];
    const totalOnHand = remaining.reduce((s, l) => s + l.qty, 0);

    rows.push({
      itemId: it.id,
      skuCode: it.skuCode,
      itemName: it.name,
      vendorId: it.vendor.id,
      vendorCode: it.vendor.code,
      vendorName: it.vendor.name,
      model,
      thresholdDays: threshold,
      oldestDate: oldest.date,
      oldestAgeDays: oldest.ageDays,
      staleQty,
      staleValue,
      totalOnHand,
      layers: remaining,
    });
  }

  rows.sort((a, b) => b.staleValue - a.staleValue);
  const totalStaleValue = rows.reduce((s, r) => s + r.staleValue, 0);
  return { rows, defaultDays: DEFAULT_STALE_DAYS, totalStaleValue };
}
