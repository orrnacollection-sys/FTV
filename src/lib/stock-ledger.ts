import { prisma } from "@/lib/db";

/**
 * Stock Ledger — every inventory movement for a SKU, chronologically, with a
 * running balance (bank-statement style). Movement sources and their effect on
 * the total on-hand balance (which mirrors the Stock Report):
 *
 *   INWARD      GRN PURCHASE line   + accepted (qty − rejected)
 *   REJECT_IN   GRN RFV line        + accepted   (goods back in from vendor)
 *   REJECT_OUT  GRN RTV line        − accepted   (goods returned to vendor)
 *   SALE        Sale.qtySold        − qty
 *   RETURN      Sale.qtyReturn      + qty
 *   RTO         Sale.qtyRTO         + qty
 *   ADJUSTMENT  StockAdjustment     ± qtyChange
 *   TRANSFER    WarehouseTransfer   shown for visibility, but does NOT change
 *                                   the total balance — it's an internal move
 *                                   between locations (the Stock Report total
 *                                   ignores transfers too).
 *
 * The running balance is computed over the SKU's FULL history; the date / type
 * / warehouse filters only hide rows from the display, so each visible row still
 * shows the true point-in-time balance.
 */

const UNASSIGNED = "—";

export type LedgerMovement = {
  key: string;
  itemId: string;
  skuCode: string;
  itemName: string;
  vendor: string;
  model: string | null;
  date: Date;
  type: string; // INWARD | REJECT_IN | REJECT_OUT | SALE | RETURN | RTO | ADJUSTMENT | TRANSFER
  ref: string | null;
  warehouse: string | null;
  inQty: number;
  outQty: number;
  affectsBalance: boolean;
  balance: number;
};

export const LEDGER_TYPES = ["INWARD", "REJECT_IN", "REJECT_OUT", "SALE", "RETURN", "RTO", "ADJUSTMENT", "TRANSFER"] as const;

// Intra-day ordering so the running balance is deterministic when several
// movements share a date (inflows before outflows). Does not change the final
// balance, only row order.
const KIND_ORDER: Record<string, number> = {
  INWARD: 1, REJECT_IN: 2, RETURN: 3, RTO: 4, ADJUSTMENT: 5, TRANSFER: 6, SALE: 7, REJECT_OUT: 8,
};

export async function buildStockLedger(opts: {
  /** Multi-company scope — the active company id. Required so this helper
   *  pulls the books for one company at a time (no cross-leak in reports). */
  companyId: string;
  itemId?: string;
  q?: string;
  vendorId?: string;
  model?: string;
  from?: Date | null;
  to?: Date | null; // inclusive upper bound (caller passes start-of-next-day)
  type?: string;
  warehouseId?: string;
}): Promise<{ movements: LedgerMovement[]; itemCount: number }> {
  const { companyId } = opts;
  const itemWhere: Record<string, unknown> = { companyId };
  if (opts.itemId) itemWhere.id = opts.itemId;
  if (opts.q) itemWhere.OR = [{ skuCode: { contains: opts.q } }, { name: { contains: opts.q } }];
  if (opts.vendorId) itemWhere.vendorId = opts.vendorId;

  const items = await prisma.item.findMany({
    where: itemWhere,
    select: {
      id: true, skuCode: true, name: true,
      vendor: { select: { code: true, name: true, model: true } },
      priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } },
    },
    orderBy: { skuCode: "asc" },
  });

  const itemMeta = new Map<string, { skuCode: string; name: string; vendor: string; model: string | null }>();
  for (const it of items) {
    const model = it.priceRevisions[0]?.model ?? it.vendor.model;
    if (opts.model && model !== opts.model) continue;
    itemMeta.set(it.id, {
      skuCode: it.skuCode,
      name: it.name,
      vendor: `${it.vendor.code ?? "—"} · ${it.vendor.name}`,
      model,
    });
  }
  const itemIds = [...itemMeta.keys()];
  if (itemIds.length === 0) return { movements: [], itemCount: 0 };

  const [grnLines, sales, adjustments, transfers, warehouses] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { itemId: { in: itemIds }, grn: { isDraft: false } },
      select: { id: true, itemId: true, qty: true, rejectedQty: true, grn: { select: { grnNo: true, grnDate: true, type: true, warehouseId: true } } },
    }),
    prisma.sale.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true, itemId: true, vchDate: true, marketplace: true, qtySold: true, qtyReturn: true, qtyRTO: true, warehouseId: true },
    }),
    prisma.stockAdjustment.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true, itemId: true, adjNo: true, date: true, qtyChange: true, reason: true, warehouseId: true },
    }),
    prisma.warehouseTransfer.findMany({
      where: { itemId: { in: itemIds } },
      select: {
        id: true, itemId: true, docNo: true, date: true, type: true, location: true, qty: true,
        fromWarehouse: { select: { code: true } },
        toWarehouse: { select: { code: true } },
      },
    }),
    prisma.warehouse.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  const whLabel = new Map(warehouses.map((w) => [w.id, `${w.code} · ${w.name}`]));

  // Build raw movements (no balance yet).
  type Raw = Omit<LedgerMovement, "balance" | "skuCode" | "itemName" | "vendor" | "model"> & { warehouseId: string | null };
  const raw: Raw[] = [];

  for (const g of grnLines) {
    const accepted = g.qty - g.rejectedQty;
    if (accepted === 0) continue;
    if (g.grn.type === "RTV") {
      raw.push({ key: `g${g.id}`, itemId: g.itemId, date: g.grn.grnDate, type: "REJECT_OUT", ref: g.grn.grnNo, warehouse: g.grn.warehouseId ? whLabel.get(g.grn.warehouseId) ?? null : null, warehouseId: g.grn.warehouseId, inQty: 0, outQty: accepted, affectsBalance: true });
    } else if (g.grn.type === "RFV") {
      raw.push({ key: `g${g.id}`, itemId: g.itemId, date: g.grn.grnDate, type: "REJECT_IN", ref: g.grn.grnNo, warehouse: g.grn.warehouseId ? whLabel.get(g.grn.warehouseId) ?? null : null, warehouseId: g.grn.warehouseId, inQty: accepted, outQty: 0, affectsBalance: true });
    } else {
      raw.push({ key: `g${g.id}`, itemId: g.itemId, date: g.grn.grnDate, type: "INWARD", ref: g.grn.grnNo, warehouse: g.grn.warehouseId ? whLabel.get(g.grn.warehouseId) ?? null : null, warehouseId: g.grn.warehouseId, inQty: accepted, outQty: 0, affectsBalance: true });
    }
  }

  for (const s of sales) {
    const wh = s.warehouseId ? whLabel.get(s.warehouseId) ?? null : null;
    if (s.qtySold > 0) raw.push({ key: `s${s.id}sold`, itemId: s.itemId, date: s.vchDate, type: "SALE", ref: s.marketplace, warehouse: wh, warehouseId: s.warehouseId, inQty: 0, outQty: s.qtySold, affectsBalance: true });
    if (s.qtyReturn > 0) raw.push({ key: `s${s.id}ret`, itemId: s.itemId, date: s.vchDate, type: "RETURN", ref: s.marketplace, warehouse: wh, warehouseId: s.warehouseId, inQty: s.qtyReturn, outQty: 0, affectsBalance: true });
    if (s.qtyRTO > 0) raw.push({ key: `s${s.id}rto`, itemId: s.itemId, date: s.vchDate, type: "RTO", ref: s.marketplace, warehouse: wh, warehouseId: s.warehouseId, inQty: s.qtyRTO, outQty: 0, affectsBalance: true });
  }

  for (const a of adjustments) {
    const wh = a.warehouseId ? whLabel.get(a.warehouseId) ?? null : null;
    raw.push({ key: `a${a.id}`, itemId: a.itemId, date: a.date, type: "ADJUSTMENT", ref: a.adjNo ?? a.reason, warehouse: wh, warehouseId: a.warehouseId, inQty: a.qtyChange > 0 ? a.qtyChange : 0, outQty: a.qtyChange < 0 ? -a.qtyChange : 0, affectsBalance: true });
  }

  for (const t of transfers) {
    // Net-zero to the total balance; shown for visibility with its direction.
    // New rows show "FROM → TO" using warehouse codes; legacy rows fall back to
    // the type+location text.
    const label = t.fromWarehouse && t.toWarehouse
      ? `${t.fromWarehouse.code} → ${t.toWarehouse.code}`
      : (t.type === "RETURN_TO_HO" ? "↩ to HO" : "→ " + (t.location || "WH"));
    raw.push({ key: `t${t.id}`, itemId: t.itemId, date: t.date, type: "TRANSFER", ref: `${t.docNo ?? ""} ${label}`.trim(), warehouse: label, warehouseId: null, inQty: 0, outQty: 0, affectsBalance: false });
  }

  // Group by item, sort chronologically, accumulate balance.
  const byItem = new Map<string, Raw[]>();
  for (const r of raw) {
    const arr = byItem.get(r.itemId) ?? [];
    arr.push(r);
    byItem.set(r.itemId, arr);
  }

  const out: LedgerMovement[] = [];
  for (const [itemId, list] of byItem) {
    const meta = itemMeta.get(itemId);
    if (!meta) continue;
    list.sort((x, y) => x.date.getTime() - y.date.getTime() || (KIND_ORDER[x.type] ?? 9) - (KIND_ORDER[y.type] ?? 9));
    let bal = 0;
    for (const r of list) {
      if (r.affectsBalance) bal += r.inQty - r.outQty;
      // Display filters (do not affect the computed balance).
      if (opts.from && r.date < opts.from) continue;
      if (opts.to && r.date >= opts.to) continue;
      if (opts.type && r.type !== opts.type) continue;
      if (opts.warehouseId && r.warehouseId !== opts.warehouseId) continue;
      out.push({
        key: r.key, itemId, skuCode: meta.skuCode, itemName: meta.name, vendor: meta.vendor, model: meta.model,
        date: r.date, type: r.type, ref: r.ref, warehouse: r.warehouse ?? UNASSIGNED,
        inQty: r.inQty, outQty: r.outQty, affectsBalance: r.affectsBalance, balance: bal,
      });
    }
  }

  out.sort((x, y) => y.date.getTime() - x.date.getTime() || x.skuCode.localeCompare(y.skuCode) || (KIND_ORDER[y.type] ?? 9) - (KIND_ORDER[x.type] ?? 9));
  return { movements: out, itemCount: itemMeta.size };
}
