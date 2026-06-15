import { prisma } from "@/lib/db";

/**
 * Inventory valuation at vendor cost on a FIFO basis.
 *
 * On-hand quantity mirrors the Stock Report (purchase + RFV − RTV − sold
 * + returns + RTO + adjustments). Cost layers are the PURCHASE and RFV GRN
 * lines — each carries its receipt qty and rate. The on-hand units are valued
 * against the layers oldest-receipt-first: the oldest layers are treated as
 * already sold, so the units still on hand carry the most recent purchase
 * rates. Any on-hand quantity beyond the costed layers (e.g. opening balance
 * or positive stock adjustments with no purchase behind them) is valued at the
 * item's latest transfer price and the row is flagged `estimated`.
 *
 * Valuation is pooled per SKU (one FIFO unit price + one Total Value); the
 * warehouse columns only split the quantity.
 */

const UNASSIGNED = "UNASSIGNED";

export type ValuationColumn = { key: string; label: string };

export type ValuationRow = {
  id: string;
  skuCode: string;
  name: string;
  vendor: string;
  model: string | null;
  perWarehouse: Record<string, number>;
  onHand: number;
  fifoPrice: number; // effective unit cost = totalValue / onHand
  totalValue: number;
  estimated: boolean; // true if any part of the value used the fallback price
};

export type ValuationResult = {
  columns: ValuationColumn[];
  rows: ValuationRow[];
  totals: { onHand: number; totalValue: number };
};

export async function buildInventoryValuation(opts: {
  companyId: string;
  q?: string;
  vendorId?: string;
  model?: string;
  warehouseId?: string;
}): Promise<ValuationResult> {
  const { companyId } = opts;
  const itemWhere: Record<string, unknown> = { companyId };
  if (opts.q) itemWhere.OR = [{ skuCode: { contains: opts.q } }, { name: { contains: opts.q } }];
  if (opts.vendorId) itemWhere.vendorId = opts.vendorId;

  const [items, warehouses] = await Promise.all([
    prisma.item.findMany({
      where: itemWhere,
      select: {
        id: true,
        skuCode: true,
        name: true,
        vendor: { select: { code: true, name: true, model: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true, transferPrice: true } },
      },
      orderBy: { skuCode: "asc" },
    }),
    prisma.warehouse.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const itemIds = items.map((i) => i.id);

  const [grnLines, sales, adjustments] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { itemId: { in: itemIds }, grn: { isDraft: false } },
      select: { itemId: true, qty: true, rejectedQty: true, rate: true, grn: { select: { type: true, grnDate: true, warehouseId: true } } },
    }),
    prisma.sale.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, warehouseId: true, qtySold: true, qtyReturn: true, qtyRTO: true },
    }),
    prisma.stockAdjustment.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, warehouseId: true, qtyChange: true },
    }),
  ]);

  // Per-(item, warehouse) balance — mirrors the Warehouse Stock pivot.
  const balByItem = new Map<string, Map<string, number>>();
  const addBal = (itemId: string, whKey: string, delta: number) => {
    let m = balByItem.get(itemId);
    if (!m) { m = new Map(); balByItem.set(itemId, m); }
    m.set(whKey, (m.get(whKey) ?? 0) + delta);
  };

  // Cost layers per item (PURCHASE + RFV bring stock in at a known rate).
  const layersByItem = new Map<string, { qty: number; rate: number; date: number }[]>();
  for (const g of grnLines) {
    const accepted = g.qty - g.rejectedQty;
    const whKey = g.grn.warehouseId ?? UNASSIGNED;
    if (g.grn.type === "RTV") {
      addBal(g.itemId, whKey, -accepted);
    } else {
      // PURCHASE or RFV — both add to stock.
      addBal(g.itemId, whKey, accepted);
      const arr = layersByItem.get(g.itemId) ?? [];
      arr.push({ qty: accepted, rate: g.rate, date: g.grn.grnDate.getTime() });
      layersByItem.set(g.itemId, arr);
    }
  }
  for (const s of sales) {
    addBal(s.itemId, s.warehouseId ?? UNASSIGNED, -s.qtySold + s.qtyReturn + s.qtyRTO);
  }
  for (const a of adjustments) {
    addBal(a.itemId, a.warehouseId ?? UNASSIGNED, a.qtyChange);
  }

  // Columns: a single warehouse if filtered, else all + Unassigned (if used).
  const anyUnassigned = [...balByItem.values()].some((m) => (m.get(UNASSIGNED) ?? 0) !== 0);
  const columns: ValuationColumn[] = opts.warehouseId
    ? warehouses.filter((w) => w.id === opts.warehouseId).map((w) => ({ key: w.id, label: `${w.code} · ${w.name}` }))
    : [
        ...warehouses.map((w) => ({ key: w.id, label: `${w.code} · ${w.name}` })),
        ...(anyUnassigned ? [{ key: UNASSIGNED, label: "Unassigned" }] : []),
      ];

  const rows: ValuationRow[] = items.map((it) => {
    const balMap = balByItem.get(it.id) ?? new Map<string, number>();
    const perWarehouse: Record<string, number> = {};
    for (const c of columns) perWarehouse[c.key] = balMap.get(c.key) ?? 0;
    let onHand = 0;
    for (const v of balMap.values()) onHand += v;

    const latestRate = it.priceRevisions[0]?.transferPrice ?? 0;
    const model = it.priceRevisions[0]?.model ?? it.vendor.model;

    const layers = (layersByItem.get(it.id) ?? []).slice().sort((a, b) => a.date - b.date);
    const layerQty = layers.reduce((s, l) => s + l.qty, 0);

    let totalValue = 0;
    let estimated = false;
    if (onHand > 0) {
      const keep = Math.min(onHand, layerQty); // units valued from real layers
      let consume = layerQty - keep; // oldest units treated as already sold
      for (const l of layers) {
        if (consume >= l.qty) { consume -= l.qty; continue; }
        totalValue += (l.qty - consume) * l.rate;
        consume = 0;
      }
      const excess = onHand - keep; // unbacked stock → fallback price
      if (excess > 0) {
        totalValue += excess * latestRate;
        estimated = true;
      }
      if (layerQty === 0) estimated = true;
    }

    const fifoPrice = onHand > 0 ? totalValue / onHand : 0;
    return {
      id: it.id,
      skuCode: it.skuCode,
      name: it.name,
      vendor: `${it.vendor.code ?? "—"} · ${it.vendor.name}`,
      model,
      perWarehouse,
      onHand,
      fifoPrice,
      totalValue,
      estimated,
    };
  });

  // Model is resolved per item from its latest revision, so the model filter is
  // applied here rather than at the DB query level.
  const filtered = opts.model ? rows.filter((r) => r.model === opts.model) : rows;

  const totals = filtered.reduce(
    (acc, r) => { acc.onHand += r.onHand; acc.totalValue += r.totalValue; return acc; },
    { onHand: 0, totalValue: 0 },
  );

  return { columns, rows: filtered, totals };
}
