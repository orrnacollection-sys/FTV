import Link from "next/link";
import { prisma } from "@/lib/db";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { companyWhere } from "@/lib/scope";
import { SalesTable } from "./SalesTable";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; marketplace?: string; type?: string; vendorId?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const scope = await companyWhere();

  const where: Record<string, unknown> = { ...scope };
  if (sp.type) where.transactionType = sp.type;
  if (sp.marketplace) where.marketplace = { contains: sp.marketplace };
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    // Use lt next-day so the chosen "to" date is INCLUDED.
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.vchDate = d;
  }
  if (sp.vendorId) where.vendorId = sp.vendorId;
  if (sp.q) {
    where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };
  }

  const [sales, vendors] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        item: { include: { vendor: { select: { code: true, name: true, model: true } } } },
      },
      orderBy: { vchDate: "desc" },
      take: 1000,
    }),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
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
      vendorName: s.item.vendor.name,
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
      remarks: s.manualRemarks,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Sales</h1>
          <p className="text-sm text-ink-faint">{rows.length} row{rows.length === 1 ? "" : "s"} {rows.length === 1000 ? "(first 1000 shown — refine filters)" : ""}</p>
        </div>
        <Link href="/sales/new" className="btn-primary">+ Record Sale</Link>
      </div>
      <SalesTable
        rows={rows}
        vendors={vendors}
        initial={{
          q: sp.q ?? "",
          marketplace: sp.marketplace ?? "",
          type: sp.type ?? "",
          vendorId: sp.vendorId ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
