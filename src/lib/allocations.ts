/**
 * Receipt-against-order allocation helpers (#130 — Banking Phase 3).
 *
 * Three core operations:
 *   1. Outstanding orders per customer (for the allocation picker).
 *   2. Outstanding receipt amount per BankTransaction.
 *   3. Allocate a chunk of receipt to an order.
 */
import { prisma } from "@/lib/db";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OutstandingOrder = {
  id: string;
  invoiceNo: string | null;
  date: Date;
  total: number;
  allocated: number;
  outstanding: number;
  customerId: string | null;
  customerName: string | null;
  channel: string;
  marketplace: string;
  type: string;
};

/** All non-zero-outstanding SALE orders, optionally filtered by customer.
 *  Excludes RETURN/RTO (they're credit notes — opposite direction). */
export async function getOutstandingOrders(input: {
  customerId?: string;
  /** Only consider orders dated on or before this date (defaults to today). */
  asOf?: Date;
}): Promise<OutstandingOrder[]> {
  const where: import("@prisma/client").Prisma.MarketplaceOrderWhereInput = {
    type: "SALE",
    total: { gt: 0 },
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.asOf ? { date: { lte: input.asOf } } : {}),
  };
  const orders = await prisma.marketplaceOrder.findMany({
    where,
    orderBy: { date: "asc" },
    include: {
      customer: { select: { id: true, name: true } },
      allocations: { select: { amount: true } },
    },
  });
  return orders
    .map((o) => {
      const allocated = round2(o.allocations.reduce((s, a) => s + a.amount, 0));
      const outstanding = round2(o.total - allocated);
      return {
        id: o.id,
        invoiceNo: o.invoiceNo,
        date: o.date,
        total: round2(o.total),
        allocated,
        outstanding,
        customerId: o.customerId,
        customerName: o.customer?.name ?? null,
        channel: o.channel,
        marketplace: o.marketplace,
        type: o.type,
      };
    })
    .filter((o) => o.outstanding > 0.01);
}

/** How much of a RECEIPT BankTransaction is still unallocated. */
export async function getReceiptOutstanding(bankTransactionId: string): Promise<{
  receipt: { id: string; amount: number; type: string; customerId: string | null };
  allocated: number;
  unallocated: number;
} | null> {
  const t = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
    select: {
      id: true,
      amount: true,
      type: true,
      customerId: true,
      allocations: { select: { amount: true } },
    },
  });
  if (!t) return null;
  const allocated = round2(t.allocations.reduce((s, a) => s + a.amount, 0));
  return {
    receipt: { id: t.id, amount: round2(t.amount), type: t.type, customerId: t.customerId },
    allocated,
    unallocated: round2(t.amount - allocated),
  };
}

/** Allocate `amount` of receipt to an order. Validates:
 *  - receipt is a RECEIPT type
 *  - order is a SALE (not RETURN/RTO)
 *  - amount > 0 and ≤ both unallocated receipt and order outstanding
 *  Single transaction so a race can't over-allocate. */
export async function allocateReceipt(input: {
  bankTransactionId: string;
  orderId: string;
  amount: number;
  by: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const amt = round2(input.amount);
  if (amt <= 0) return { ok: false, error: "Amount must be > 0" };

  try {
    const id = await prisma.$transaction(async (tx) => {
      const txn = await tx.bankTransaction.findUnique({
        where: { id: input.bankTransactionId },
        select: { id: true, amount: true, type: true, allocations: { select: { amount: true } } },
      });
      if (!txn) throw new Error("Receipt not found");
      if (txn.type !== "RECEIPT") throw new Error(`Cannot allocate ${txn.type} — only RECEIPT`);
      const txnAllocated = txn.allocations.reduce((s, a) => s + a.amount, 0);
      const txnUnallocated = round2(txn.amount - txnAllocated);
      if (amt > txnUnallocated + 0.01) {
        throw new Error(`Only ₹${txnUnallocated.toFixed(2)} left on this receipt`);
      }

      const order = await tx.marketplaceOrder.findUnique({
        where: { id: input.orderId },
        select: { id: true, total: true, type: true, allocations: { select: { amount: true } } },
      });
      if (!order) throw new Error("Order not found");
      if (order.type !== "SALE") throw new Error(`Cannot allocate against ${order.type} — only SALE orders`);
      const orderAllocated = order.allocations.reduce((s, a) => s + a.amount, 0);
      const orderOutstanding = round2(order.total - orderAllocated);
      if (amt > orderOutstanding + 0.01) {
        throw new Error(`Order only owes ₹${orderOutstanding.toFixed(2)}`);
      }

      const row = await tx.bankReceiptAllocation.create({
        data: {
          bankTransactionId: input.bankTransactionId,
          orderId: input.orderId,
          amount: amt,
          allocatedBy: input.by,
        },
        select: { id: true },
      });
      return row.id;
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Allocation failed" };
  }
}

/** Remove an allocation row — frees both the order outstanding and the
 *  receipt unallocated. */
export async function removeAllocation(allocationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await prisma.bankReceiptAllocation.delete({ where: { id: allocationId } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

/** Customer A/R ageing buckets — used by the customer ledger view to show
 *  what's overdue. Buckets in days: 0-30, 31-60, 61-90, 90+. */
export async function getCustomerAgeing(customerId: string, asOf: Date = new Date()): Promise<{
  total: number;
  current: number;     // 0-30
  d31_60: number;
  d61_90: number;
  d90plus: number;
  orders: OutstandingOrder[];
}> {
  const orders = await getOutstandingOrders({ customerId, asOf });
  const DAY = 86400 * 1000;
  let current = 0, d31_60 = 0, d61_90 = 0, d90plus = 0;
  for (const o of orders) {
    const ageDays = Math.floor((asOf.getTime() - o.date.getTime()) / DAY);
    if (ageDays <= 30) current += o.outstanding;
    else if (ageDays <= 60) d31_60 += o.outstanding;
    else if (ageDays <= 90) d61_90 += o.outstanding;
    else d90plus += o.outstanding;
  }
  return {
    total: round2(current + d31_60 + d61_90 + d90plus),
    current: round2(current),
    d31_60: round2(d31_60),
    d61_90: round2(d61_90),
    d90plus: round2(d90plus),
    orders,
  };
}
