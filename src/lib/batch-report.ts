import { prisma } from "@/lib/db";

/**
 * Batch reporting. A "batch" = a GRN receipt (type PURCHASE or RFV); its line
 * items are the SKUs in that batch. Sales are not batch-linked, so each SKU's
 * net consumption (sold − return − RTO) is allocated to its batches
 * oldest-expiry-first (FIFO); Sale/RTO/Return are split proportional to the
 * consumed share so per-batch figures reconcile to the SKU totals.
 */

export type BatchSummaryRow = {
  grnId: string;
  batchNo: string;
  inwardDate: Date;
  expiry: Date | null;
  type: string; // PURCHASE | RFV
  vendorId: string;
  vendorCode: string | null;
  vendorName: string;
  warehouse: string | null;
  model: string | null;
  totalInward: number;
  totalSale: number;
  totalRTO: number;
  totalReturn: number;
  net: number;
  pctReturn: number;
  balQty: number;
  reviewDate: Date | null;
  remarks: string | null;
};

export type BatchSkuRow = {
  skuCode: string;
  itemName: string;
  warehouse: string | null;
  model: string | null;
  inward: number;
  sale: number;
  rto: number;
  ret: number;
  net: number;
  pctReturn: number;
  balQty: number;
};

type LineMetric = {
  grnId: string;
  itemId: string;
  inward: number;
  sale: number;
  rto: number;
  ret: number;
  consumed: number; // net units consumed from this batch line
};

/** Core: compute per-(GRN line) batch metrics via FIFO allocation of SKU sales.
 *  Scoped to the given company so cross-company sales never bleed into
 *  another company's batch utilisation. */
async function computeLineMetrics(companyId: string): Promise<{
  byKey: Map<string, LineMetric>; // key = `${grnId}|${itemId}`
}> {
  const [lines, saleAggs] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { grn: { companyId, type: { in: ["PURCHASE", "RFV"] }, isDraft: false } },
      select: { grnId: true, itemId: true, qty: true, batchExpDate: true },
    }),
    prisma.sale.groupBy({
      by: ["itemId"],
      where: { companyId },
      _sum: { qtySold: true, qtyReturn: true, qtyRTO: true },
    }),
  ]);

  const salesByItem = new Map(
    saleAggs.map((s) => [s.itemId, { S: s._sum.qtySold ?? 0, R: s._sum.qtyReturn ?? 0, T: s._sum.qtyRTO ?? 0 }]),
  );

  // Group inward lines per SKU, oldest expiry first (FIFO).
  const batchesByItem = new Map<string, { grnId: string; inward: number; exp: number }[]>();
  for (const l of lines) {
    const arr = batchesByItem.get(l.itemId) ?? [];
    arr.push({ grnId: l.grnId, inward: l.qty, exp: l.batchExpDate.getTime() });
    batchesByItem.set(l.itemId, arr);
  }

  const byKey = new Map<string, LineMetric>();
  for (const [itemId, batches] of batchesByItem) {
    batches.sort((a, b) => a.exp - b.exp);
    const totals = salesByItem.get(itemId) ?? { S: 0, R: 0, T: 0 };
    const N = Math.max(0, totals.S - totals.R - totals.T); // net consumed units
    let remaining = N;
    for (const b of batches) {
      const consumed = Math.min(b.inward, remaining);
      remaining -= consumed;
      const share = N > 0 ? consumed / N : 0;
      byKey.set(`${b.grnId}|${itemId}`, {
        grnId: b.grnId,
        itemId,
        inward: b.inward,
        sale: totals.S * share,
        rto: totals.T * share,
        ret: totals.R * share,
        consumed,
      });
    }
  }

  return { byKey };
}

export async function buildBatchSummary(companyId: string): Promise<BatchSummaryRow[]> {
  const { byKey } = await computeLineMetrics(companyId);

  const grns = await prisma.gRN.findMany({
    where: { companyId, type: { in: ["PURCHASE", "RFV"] }, isDraft: false },
    select: {
      id: true, grnNo: true, grnDate: true, type: true, vendorId: true, reviewDate: true, batchRemarks: true,
      vendor: { select: { code: true, name: true } },
      warehouse: { select: { code: true, name: true } },
      items: { select: { itemId: true, batchExpDate: true, model: true } },
    },
    orderBy: { grnDate: "desc" },
  });

  return grns.map((g) => {
    let inward = 0, sale = 0, rto = 0, ret = 0, consumed = 0;
    let expiry: Date | null = null;
    const models = new Set<string>();
    for (const it of g.items) {
      const m = byKey.get(`${g.id}|${it.itemId}`);
      if (m) {
        inward += m.inward; sale += m.sale; rto += m.rto; ret += m.ret; consumed += m.consumed;
      }
      if (it.model) models.add(it.model);
      if (!expiry || it.batchExpDate > expiry) expiry = it.batchExpDate;
    }
    return {
      grnId: g.id,
      batchNo: g.grnNo,
      inwardDate: g.grnDate,
      expiry,
      type: g.type,
      vendorId: g.vendorId,
      vendorCode: g.vendor.code,
      vendorName: g.vendor.name,
      warehouse: g.warehouse ? `${g.warehouse.code} · ${g.warehouse.name}` : null,
      model: models.size === 1 ? [...models][0] : models.size > 1 ? "Mixed" : null,
      totalInward: inward,
      totalSale: sale,
      totalRTO: rto,
      totalReturn: ret,
      net: consumed,
      pctReturn: sale > 0 ? (ret / sale) * 100 : 0,
      balQty: inward - consumed,
      reviewDate: g.reviewDate,
      remarks: g.batchRemarks,
    };
  });
}

export async function buildBatchSkuReport(companyId: string, grnId: string): Promise<{
  batch: { batchNo: string; inwardDate: Date; expiry: Date | null; vendorName: string; warehouse: string | null } | null;
  rows: BatchSkuRow[];
}> {
  // Use findFirst with the companyId guard so a GRN id from another company
  // can't be opened by switching the URL on this page.
  const grn = await prisma.gRN.findFirst({
    where: { id: grnId, companyId },
    select: {
      grnNo: true, grnDate: true, type: true,
      vendor: { select: { code: true, name: true, model: true } },
      warehouse: { select: { code: true, name: true } },
      items: {
        select: { itemId: true, batchExpDate: true, model: true, item: { select: { skuCode: true, name: true } } },
      },
    },
  });
  if (!grn) return { batch: null, rows: [] };

  const { byKey } = await computeLineMetrics(companyId);
  const whLabel = grn.warehouse ? `${grn.warehouse.code} · ${grn.warehouse.name}` : null;

  let expiry: Date | null = null;
  const rows: BatchSkuRow[] = grn.items.map((it) => {
    const m = byKey.get(`${grnId}|${it.itemId}`);
    const inward = m?.inward ?? 0;
    const sale = m?.sale ?? 0;
    const rto = m?.rto ?? 0;
    const ret = m?.ret ?? 0;
    const net = m?.consumed ?? 0;
    if (!expiry || it.batchExpDate > expiry) expiry = it.batchExpDate;
    return {
      skuCode: it.item.skuCode,
      itemName: it.item.name,
      warehouse: whLabel,
      model: it.model,
      inward, sale, rto, ret, net,
      pctReturn: sale > 0 ? (ret / sale) * 100 : 0,
      balQty: inward - net,
    };
  });

  return {
    batch: { batchNo: grn.grnNo, inwardDate: grn.grnDate, expiry, vendorName: grn.vendor.name, warehouse: whLabel },
    rows,
  };
}
