/**
 * Orders ↔ Sale sync (Orders unification, #114).
 *
 * Every MarketplaceOrder row is paired 1:1 with a Sale row so the
 * stock-side (Stock Report, Inventory Valuation, FIFO, Vendor Ledger)
 * keeps working unchanged while admins only ever touch /orders.
 *
 * Public surface:
 *   - upsertSaleForOrder(orderId, tx)   — create or update the paired Sale
 *   - deleteSaleForOrder(orderId, tx)   — remove the paired Sale
 *
 * Call these inside the same `prisma.$transaction` that creates/updates the
 * Order; cascade-delete on the Sale's `sourceOrderId` FK means deleting the
 * Order alone also wipes the Sale, but callers can also call this helper
 * explicitly for symmetry.
 */
import type { Prisma } from "@prisma/client";
import { resolvePrice } from "@/lib/price-lookup";

/**
 * Project an Order's `type` to the Sale.transactionType + qty columns.
 *   SALE   → transactionType=SALE,   qtySold=qty
 *   RETURN → transactionType=RETURN, qtyReturn=qty
 *   RTO    → transactionType=RETURN, qtyRTO=qty
 * (Sale's transactionType is a 2-state union; RTOs share the RETURN bucket
 *  but with a different qty column so reports can still tell them apart.)
 */
function qtyColumnsForType(orderType: string, qty: number) {
  if (orderType === "RETURN") {
    return { transactionType: "RETURN", qtySold: 0, qtyReturn: qty, qtyRTO: 0 };
  }
  if (orderType === "RTO") {
    return { transactionType: "RETURN", qtySold: 0, qtyReturn: 0, qtyRTO: qty };
  }
  return { transactionType: "SALE", qtySold: qty, qtyReturn: 0, qtyRTO: 0 };
}

/**
 * Create or update the paired Sale row for an Order. Idempotent — safe to
 * call after an Order create OR an update; will INSERT on first call,
 * UPDATE on subsequent calls.
 */
export async function upsertSaleForOrder(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const order = await tx.marketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      item: { select: { vendorId: true } },
      sale: { select: { id: true } },
    },
  });
  if (!order) throw new Error(`Order ${orderId} not found for sync`);

  // Effective price revision at order date → model snapshot.
  // Falls back to the item's current vendor.model if no revision exists
  // (legacy items without a price history don't block import).
  const priced = await resolvePrice(order.itemId, order.date, tx);
  const model = priced?.model ?? null;

  const qtyCols = qtyColumnsForType(order.type, order.qty);

  const saleData = {
    vchDate: order.date,
    marketplace: order.marketplace,
    itemId: order.itemId,
    vendorId: order.item.vendorId,
    warehouseId: order.warehouseId,
    transactionType: qtyCols.transactionType,
    model,
    qtySold: qtyCols.qtySold,
    qtyReturn: qtyCols.qtyReturn,
    qtyRTO: qtyCols.qtyRTO,
    // Sale.unitRate is the VENDOR-side transfer price — what we owe the
    // vendor per unit. The Sale row is the vendor-facing line ledger and
    // is shared with the vendor via the portal; the customer-facing
    // salePrice (Order.salePrice) MUST NOT leak through here.
    unitRate: order.transferPrice,
    taxRate: order.gstRate,
    manualRemarks: order.remarks,
    sourceOrderId: order.id,
    createdBy: order.createdBy ?? null,
  };

  if (order.sale) {
    await tx.sale.update({ where: { id: order.sale.id }, data: saleData });
  } else {
    await tx.sale.create({ data: saleData });
  }
}

/**
 * Explicit paired-Sale delete. Normally unnecessary — the FK has
 * `onDelete: Cascade` on the Sale side, so deleting the Order takes
 * the Sale with it. Provided for callers that want to delete the Sale
 * but keep the Order (e.g. an unusual "unlink" admin action).
 */
export async function deleteSaleForOrder(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.sale.deleteMany({ where: { sourceOrderId: orderId } });
}
