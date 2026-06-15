import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { buildInventoryValuation } from "@/lib/inventory-valuation";
import { getActiveCompanyId } from "@/lib/company";
import { companyWhere } from "@/lib/scope";
import { InventoryValuationView } from "./InventoryValuationView";

export const dynamic = "force-dynamic";

export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vendorId?: string; model?: string; warehouseId?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim();
  const companyId = await getActiveCompanyId();
  const scope = await companyWhere();

  const [{ columns, rows, totals }, vendors, models, warehouses] = await Promise.all([
    buildInventoryValuation({ companyId, q, vendorId: sp.vendorId, model: sp.model, warehouseId: sp.warehouseId }),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
    prisma.warehouse.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Inventory Valuation</h1>
        <p className="text-sm text-ink-faint">
          On-hand stock valued at vendor cost, FIFO by receipt date. Total Value = on-hand qty × FIFO unit cost.
        </p>
      </div>
      <InventoryValuationView
        rows={rows}
        columns={columns}
        vendors={vendors}
        models={models}
        warehouses={warehouses}
        totals={totals}
        initial={{
          q: q ?? "",
          vendorId: sp.vendorId ?? "",
          model: sp.model ?? "",
          warehouseId: sp.warehouseId ?? "",
        }}
      />
    </div>
  );
}
