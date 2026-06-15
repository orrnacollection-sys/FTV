import { prisma } from "@/lib/db";

/**
 * Current on-hand quantity for a single SKU (all warehouses combined):
 *   balance = GRN purchase accepted + RFV accepted − RTV accepted
 *           − sold + returns + RTO + net adjustments
 * Mirrors the Stock Report formula. Used by the model-switch guard.
 *
 * NOTE: RFV (Reject-In, goods back from vendor) ADDS to stock; only RTV
 * (Reject-Out, goods returned to vendor) subtracts.
 */
export async function getOnHandQty(itemId: string): Promise<number> {
  const [grnLines, saleAgg, adjAgg] = await Promise.all([
    prisma.gRNItem.findMany({
      where: { itemId, grn: { isDraft: false } },
      select: { qty: true, rejectedQty: true, grn: { select: { type: true } } },
    }),
    prisma.sale.aggregate({
      where: { itemId },
      _sum: { qtySold: true, qtyReturn: true, qtyRTO: true },
    }),
    prisma.stockAdjustment.aggregate({ where: { itemId }, _sum: { qtyChange: true } }),
  ]);

  let inward = 0;
  for (const g of grnLines) {
    const accepted = g.qty - g.rejectedQty;
    // PURCHASE and RFV both add; only RTV subtracts.
    inward += g.grn.type === "RTV" ? -accepted : accepted;
  }
  const sold = saleAgg._sum.qtySold ?? 0;
  const ret = saleAgg._sum.qtyReturn ?? 0;
  const rto = saleAgg._sum.qtyRTO ?? 0;
  const adj = adjAgg._sum.qtyChange ?? 0;

  return inward - sold + ret + rto + adj;
}
