import { requireVendor } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { VendorSalesView } from "./VendorSalesView";

export default async function VendorSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; model?: string; type?: string; from?: string; to?: string }>;
}) {
  const me = await requireVendor();
  const sp = await searchParams;

  const where: Record<string, unknown> = { vendorId: me.vendorId };
  if (sp.type) where.transactionType = sp.type;
  if (sp.model) where.model = sp.model;
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    // Use lt next-day so the chosen "to" date is INCLUDED.
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.vchDate = d;
  }
  if (sp.q) {
    where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };
  }

  const [sales, models] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: { item: { select: { skuCode: true, name: true, vendor: { select: { model: true } } } } },
      orderBy: { vchDate: "desc" },
      take: 1000,
    }),
    prisma.modelMaster.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, label: true } }),
  ]);

  const rows = sales.map((s) => {
    const netSale = s.qtySold - s.qtyReturn;
    const amount = netSale * s.unitRate;
    const gst = (amount * s.taxRate) / 100;
    return {
      id: s.id,
      vchDate: s.vchDate,
      marketplace: s.marketplace,
      skuCode: s.item.skuCode,
      itemName: s.item.name,
      model: s.model ?? s.item.vendor.model,
      transactionType: s.transactionType,
      qtySold: s.qtySold,
      qtyReturn: s.qtyReturn,
      qtyRTO: s.qtyRTO,
      netSale,
      unitRate: s.unitRate,
      amount,
      taxRate: s.taxRate,
      gst,
      totalAmount: amount + gst,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Sales</h1>
        <p className="text-sm text-ink-faint">{rows.length} row{rows.length === 1 ? "" : "s"} {rows.length === 1000 ? "(first 1000 — refine filters)" : ""} · read-only</p>
      </div>
      <VendorSalesView
        rows={rows}
        models={models}
        initial={{
          q: sp.q ?? "",
          model: sp.model ?? "",
          type: sp.type ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
