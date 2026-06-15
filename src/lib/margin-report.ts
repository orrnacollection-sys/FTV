import { prisma } from "@/lib/db";

/**
 * SKU-level margin from marketplace orders. All money is on the taxable
 * (pre-GST) value.
 *
 *   Net Sale     = Sale Value − Return Value − RTO Value
 *   Commission   = Σ per line (signed taxable × marketplace commission %)
 *   Logistics    = Σ per line (signed taxable × marketplace logistics %)
 *   Marketing    = imported marketing spend for the SKU in scope
 *   Other        = manual (0 for now)
 *   Margin       = Net Sale − Commission − Logistics − Marketing − Other   (sheet)
 *   COGS         = transfer price × net sold qty
 *   Net Margin   = Margin − COGS                                          (after vendor cost)
 *
 * Commission and logistics are applied to the signed line taxable so returns
 * and RTO reverse them proportionally.
 */

export type MarginRow = {
  itemId: string;
  skuCode: string;
  itemName: string;
  vendor: string;
  model: string | null;
  saleValue: number;
  returnValue: number;
  rtoValue: number;
  netSale: number;
  commission: number;
  logistics: number;
  marketing: number;
  other: number;
  margin: number;
  transferPrice: number; // COGS for the period
  netMargin: number;
  marginPct: number;
  netMarginPct: number;
  netQty: number;
};

export type MarginResult = {
  rows: MarginRow[];
  totals: {
    saleValue: number; netSale: number; commission: number; logistics: number;
    marketing: number; margin: number; cogs: number; netMargin: number;
  };
};

function signFor(type: string): number {
  return type === "RETURN" || type === "RTO" ? -1 : 1;
}

export async function buildMarginReport(opts: {
  companyId: string;
  month?: string; // "YYYY-MM"
  vendorId?: string;
  model?: string;
  marketplace?: string;
}): Promise<MarginResult> {
  const { companyId } = opts;
  const orderWhere: Record<string, unknown> = { companyId };
  if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [y, m] = opts.month.split("-").map(Number);
    orderWhere.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  if (opts.marketplace) orderWhere.marketplace = { contains: opts.marketplace };

  const orders = await prisma.marketplaceOrder.findMany({
    where: orderWhere,
    select: { itemId: true, marketplace: true, type: true, qty: true, taxableValue: true },
  });
  if (orders.length === 0) {
    return { rows: [], totals: { saleValue: 0, netSale: 0, commission: 0, logistics: 0, marketing: 0, margin: 0, cogs: 0, netMargin: 0 } };
  }

  const rates = await prisma.marketplaceRate.findMany({ where: { companyId }, select: { marketplace: true, commissionPct: true, logisticsPct: true } });
  const rateByMkt = new Map(rates.map((r) => [r.marketplace.trim().toLowerCase(), r]));

  type Agg = {
    saleValue: number; returnValue: number; rtoValue: number;
    commission: number; logistics: number; netQty: number;
  };
  const aggByItem = new Map<string, Agg>();
  for (const o of orders) {
    const a = aggByItem.get(o.itemId) ?? { saleValue: 0, returnValue: 0, rtoValue: 0, commission: 0, logistics: 0, netQty: 0 };
    const sign = signFor(o.type);
    if (o.type === "RETURN") a.returnValue += o.taxableValue;
    else if (o.type === "RTO") a.rtoValue += o.taxableValue;
    else a.saleValue += o.taxableValue;
    a.netQty += sign * o.qty;
    const rate = rateByMkt.get(o.marketplace.trim().toLowerCase());
    if (rate) {
      a.commission += sign * o.taxableValue * (rate.commissionPct / 100);
      a.logistics += sign * o.taxableValue * (rate.logisticsPct / 100);
    }
    aggByItem.set(o.itemId, a);
  }

  const itemIds = [...aggByItem.keys()];
  const [items, marketing] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: itemIds }, companyId },
      select: {
        id: true, skuCode: true, name: true,
        vendor: { select: { id: true, code: true, name: true, model: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true, transferPrice: true } },
      },
    }),
    prisma.marketingCost.groupBy({
      by: ["itemId"],
      where: { companyId, itemId: { in: itemIds }, ...(opts.month ? { month: opts.month } : {}) },
      _sum: { amount: true },
    }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const marketingByItem = new Map(marketing.map((m) => [m.itemId, m._sum.amount ?? 0]));

  const rows: MarginRow[] = [];
  for (const [itemId, a] of aggByItem) {
    const it = itemById.get(itemId);
    if (!it) continue;
    if (opts.vendorId && it.vendor.id !== opts.vendorId) continue;
    const model = it.priceRevisions[0]?.model ?? it.vendor.model;
    if (opts.model && model !== opts.model) continue;

    const netSale = a.saleValue - a.returnValue - a.rtoValue;
    const marketingCost = marketingByItem.get(itemId) ?? 0;
    const other = 0;
    const margin = netSale - a.commission - a.logistics - marketingCost - other;
    const transferPrice = it.priceRevisions[0]?.transferPrice ?? 0;
    const cogs = transferPrice * a.netQty;
    const netMargin = margin - cogs;

    rows.push({
      itemId,
      skuCode: it.skuCode,
      itemName: it.name,
      vendor: `${it.vendor.code ?? "—"} · ${it.vendor.name}`,
      model,
      saleValue: a.saleValue,
      returnValue: a.returnValue,
      rtoValue: a.rtoValue,
      netSale,
      commission: a.commission,
      logistics: a.logistics,
      marketing: marketingCost,
      other,
      margin,
      transferPrice: cogs,
      netMargin,
      marginPct: netSale !== 0 ? (margin / netSale) * 100 : 0,
      netMarginPct: netSale !== 0 ? (netMargin / netSale) * 100 : 0,
      netQty: a.netQty,
    });
  }
  rows.sort((x, y) => y.netSale - x.netSale);

  const totals = rows.reduce(
    (t, r) => {
      t.saleValue += r.saleValue; t.netSale += r.netSale; t.commission += r.commission;
      t.logistics += r.logistics; t.marketing += r.marketing; t.margin += r.margin;
      t.cogs += r.transferPrice; t.netMargin += r.netMargin;
      return t;
    },
    { saleValue: 0, netSale: 0, commission: 0, logistics: 0, marketing: 0, margin: 0, cogs: 0, netMargin: 0 },
  );

  return { rows, totals };
}
