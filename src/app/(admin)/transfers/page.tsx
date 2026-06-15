import { prisma } from "@/lib/db";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { companyWhere } from "@/lib/scope";
import { TransfersPanel } from "./TransfersPanel";

export const dynamic = "force-dynamic";

const DEFAULT_TRANSFER_TYPES = ["SJIT", "SOR", "Other"];

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; transferType?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const scope = await companyWhere();

  const where: Record<string, unknown> = { ...scope };
  if (sp.transferType) where.transferType = sp.transferType;
  if (sp.q) {
    where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };
  }
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.date = d;
  }

  const [transfers, items, warehouses, distinctTypes] = await Promise.all([
    prisma.warehouseTransfer.findMany({
      where,
      include: {
        item: { select: { skuCode: true, name: true } },
        fromWarehouse: { select: { code: true, name: true } },
        toWarehouse: { select: { code: true, name: true } },
      },
      orderBy: { date: "desc" },
      take: 1000,
    }),
    prisma.item.findMany({ where: scope, orderBy: { skuCode: "asc" }, select: { id: true, skuCode: true, name: true } }),
    prisma.warehouse.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.warehouseTransfer.findMany({
      where: { ...scope, transferType: { not: null } },
      distinct: ["transferType"],
      select: { transferType: true },
    }),
  ]);

  const transferTypeOptions = [
    ...new Set([...DEFAULT_TRANSFER_TYPES, ...distinctTypes.map((d) => d.transferType).filter((v): v is string => !!v)]),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Warehouse Transfer</h1>
        <p className="text-sm text-ink-faint">Track goods sent to / returned from external warehouses.</p>
      </div>
      <TransfersPanel
        rows={transfers.map((t) => {
          const fromLabel = t.fromWarehouse ? `${t.fromWarehouse.code} · ${t.fromWarehouse.name}` : (t.type === "RETURN_TO_HO" ? (t.location ?? "?") : "HO");
          const toLabel = t.toWarehouse ? `${t.toWarehouse.code} · ${t.toWarehouse.name}` : (t.type === "SENT_TO_WH" ? (t.location ?? "?") : "HO");
          return {
            id: t.id,
            docNo: t.docNo,
            date: t.date,
            skuCode: t.item.skuCode,
            itemName: t.item.name,
            fromLabel,
            toLabel,
            tracked: !!(t.fromWarehouseId && t.toWarehouseId),
            transferType: t.transferType,
            qty: t.qty,
            notes: t.notes,
          };
        })}
        items={items}
        warehouses={warehouses}
        transferTypeOptions={transferTypeOptions}
        initial={{
          q: sp.q ?? "",
          transferType: sp.transferType ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />
    </div>
  );
}
