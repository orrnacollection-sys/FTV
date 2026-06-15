import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { buildStockLedger } from "@/lib/stock-ledger";
import { getActiveCompanyId } from "@/lib/company";
import { companyWhere } from "@/lib/scope";
import { StockLedgerView } from "./StockLedgerView";

export const dynamic = "force-dynamic";

export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; q?: string; vendorId?: string; model?: string; from?: string; to?: string; type?: string; warehouseId?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const companyId = await getActiveCompanyId();
  const scope = await companyWhere();

  const from = sp.from ? parseFlexibleDate(sp.from) : null;
  const toRaw = sp.to ? parseFlexibleDate(sp.to) : null;
  const to = toRaw ? addDays(toRaw, 1) : null;

  const [{ movements, itemCount }, vendors, models, warehouses] = await Promise.all([
    buildStockLedger({
      companyId,
      itemId: sp.itemId,
      q: sp.q?.trim(),
      vendorId: sp.vendorId,
      model: sp.model,
      from,
      to,
      type: sp.type,
      warehouseId: sp.warehouseId,
    }),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
    prisma.warehouse.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  // modelsWithData = unique models from items in the current vendor/q scope,
  // before any model filter — that's what powers the button-row "has data" hint.
  const itemWhereForModels: Record<string, unknown> = { ...scope };
  if (sp.itemId) itemWhereForModels.id = sp.itemId;
  if (sp.q?.trim()) itemWhereForModels.OR = [{ skuCode: { contains: sp.q.trim() } }, { name: { contains: sp.q.trim() } }];
  if (sp.vendorId) itemWhereForModels.vendorId = sp.vendorId;
  const itemsForModels = await prisma.item.findMany({
    where: itemWhereForModels,
    select: { vendor: { select: { model: true } }, priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } } },
  });
  const modelsWithData = [...new Set(itemsForModels.map((it) => it.priceRevisions[0]?.model ?? it.vendor.model).filter((m): m is string => !!m))];

  const singleSku = itemCount === 1;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Stock Ledger</h1>
        <p className="text-sm text-ink-faint">
          Every inventory movement with a running balance · Inward · Reject-In · Reject-Out · Sale · Return · RTO · Adjustment · Transfer
        </p>
      </div>
      <StockLedgerView
        movements={movements.map((m) => ({ ...m, date: m.date.toISOString() }))}
        singleSku={singleSku}
        vendors={vendors}
        models={models}
        modelsWithData={modelsWithData}
        warehouses={warehouses}
        initial={{
          q: sp.q ?? "",
          vendorId: sp.vendorId ?? "",
          model: sp.model ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
          type: sp.type ?? "",
          warehouseId: sp.warehouseId ?? "",
        }}
      />
    </div>
  );
}
