import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { isB2BRegType } from "@/lib/constants";
import { companyWhere } from "@/lib/scope";
import { OrdersView } from "./OrdersView";

export const dynamic = "force-dynamic";

/**
 * Net contribution sign by Order.type:
 *   SALE   → +1  (customer paid, vendor will be paid)
 *   RETURN → -1  (refund to customer, vendor reverses)
 *   RTO    → -1  (delivery failed; customer never paid, vendor not paid)
 *
 * Returns and RTOs subtract from BOTH Sales and Transfer totals so the
 * "Gross Margin" stays a true net-of-reversals number.
 */
function signFor(type: string): number {
  return type === "RETURN" || type === "RTO" ? -1 : 1;
}

type Totals = {
  rowCount: number;
  qtyNet: number;
  salesNet: number;
  transferNet: number;
  marginNet: number;
  marginPct: number | null;
  gstNet: number;
  saleCount: number;
  returnCount: number;
  rtoCount: number;
  b2bCount: number;
  b2cCount: number;
};

function emptyTotals(): Totals {
  return {
    rowCount: 0,
    qtyNet: 0,
    salesNet: 0,
    transferNet: 0,
    marginNet: 0,
    marginPct: null,
    gstNet: 0,
    saleCount: 0,
    returnCount: 0,
    rtoCount: 0,
    b2bCount: 0,
    b2cCount: 0,
  };
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; marketplace?: string; type?: string; channel?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const where: Record<string, unknown> = { ...scope };
  if (sp.type) where.type = sp.type;
  if (sp.channel) where.channel = sp.channel;
  if (sp.marketplace) where.marketplace = { contains: sp.marketplace };
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.date = d;
  }
  if (sp.q) where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };

  // Two queries: a capped list for the table + a slim aggregate for the
  // totals strip + the items list for the Record Sale picker.
  const [orders, aggregateRows, items] = await Promise.all([
    prisma.marketplaceOrder.findMany({
      where,
      include: { item: { select: { skuCode: true, name: true } } },
      orderBy: { date: "desc" },
      take: 1000,
    }),
    prisma.marketplaceOrder.findMany({
      where,
      select: {
        type: true,
        qty: true,
        salePrice: true,
        transferPrice: true,
        cgst: true,
        sgst: true,
        igst: true,
        customer: { select: { gstRegType: true } },
      },
    }),
    prisma.item.findMany({
      where: scope,
      select: {
        id: true,
        skuCode: true,
        name: true,
        vendor: { select: { code: true, name: true } },
      },
      orderBy: { skuCode: "asc" },
    }),
  ]);

  // Warehouses + Customers for the Record Sale pickers.
  const [warehouses, customers] = await Promise.all([
    prisma.warehouse.findMany({
      where: { ...scope, type: "OWN" },
      select: { id: true, code: true, name: true, state: true },
      orderBy: { code: "asc" },
    }),
    prisma.customer.findMany({
      where: { ...scope, status: "ACTIVE" },
      select: { id: true, code: true, name: true, gstRegType: true, state: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const totals = aggregateRows.reduce<Totals>((acc, r) => {
    const sign = signFor(r.type);
    const signedQty = r.qty * sign;
    acc.rowCount += 1;
    acc.qtyNet += signedQty;
    acc.salesNet += signedQty * r.salePrice;
    acc.transferNet += signedQty * r.transferPrice;
    acc.gstNet += sign * (r.cgst + r.sgst + r.igst);
    if (r.type === "RETURN") acc.returnCount += 1;
    else if (r.type === "RTO") acc.rtoCount += 1;
    else acc.saleCount += 1;
    // B2B / B2C classification — driven by customer.gstRegType when set,
    // otherwise default to B2C (most marketplace orders have no customer).
    if (isB2BRegType(r.customer?.gstRegType)) acc.b2bCount += 1;
    else acc.b2cCount += 1;
    return acc;
  }, emptyTotals());
  totals.marginNet = totals.salesNet - totals.transferNet;
  totals.marginPct = totals.salesNet !== 0
    ? (totals.marginNet / totals.salesNet) * 100
    : null;
  // Round to 2 decimals so the JSON shipped to the client is clean.
  for (const k of ["qtyNet", "salesNet", "transferNet", "marginNet", "gstNet"] as const) {
    totals[k] = Math.round((totals[k] as number) * 100) / 100;
  }
  if (totals.marginPct !== null) totals.marginPct = Math.round(totals.marginPct * 10) / 10;

  const rows = orders.map((o) => ({
    id: o.id,
    date: o.date,
    skuCode: o.item.skuCode,
    itemName: o.item.name,
    marketplace: o.marketplace,
    channel: o.channel,
    type: o.type,
    placeOfSupply: o.placeOfSupply,
    qty: o.qty,
    salePrice: o.salePrice,
    transferPrice: o.transferPrice,
    taxableValue: o.taxableValue,
    gstRate: o.gstRate,
    cgst: o.cgst,
    sgst: o.sgst,
    igst: o.igst,
    total: o.total,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Orders</h1>
        <p className="text-sm text-ink-faint">
          {rows.length} row{rows.length === 1 ? "" : "s"}{rows.length === 1000 ? " (first 1000 — refine filters)" : ""}
          {totals.rowCount > rows.length ? ` · totals over all ${totals.rowCount} matching` : ""}
          {" "}· unified sell-side ingest · auto-pushes to Sales + Returns
        </p>
      </div>
      <OrdersView
        rows={rows}
        totals={totals}
        items={items.map((i) => ({
          id: i.id,
          skuCode: i.skuCode,
          name: i.name,
          vendor: i.vendor?.code ?? i.vendor?.name ?? undefined,
        }))}
        warehouses={warehouses.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          state: w.state,
        }))}
        customers={customers.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          gstRegType: c.gstRegType,
          state: c.state,
        }))}
        initial={{
          q: sp.q ?? "",
          marketplace: sp.marketplace ?? "",
          type: sp.type ?? "",
          channel: sp.channel ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
