import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { buildStaleStock } from "@/lib/stale-stock";
import { getActiveCompanyId } from "@/lib/company";
import { NewButton } from "@/components/NewButton";
import { StaleStockView } from "./StaleStockView";

export const dynamic = "force-dynamic";

export default async function StaleStockPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string; model?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const companyId = await getActiveCompanyId();

  // Engine called without model filter so we know which models actually have
  // stale stock (for the button "has data" highlighting). Filter then applied
  // for display.
  const [{ rows: allRows, defaultDays, totalStaleValue: totalAll }, vendors, models] = await Promise.all([
    buildStaleStock({ companyId, vendorId: sp.vendorId }),
    prisma.vendor.findMany({ where: { companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, staleDays: true } }),
    getActiveModels(),
  ]);
  const modelsWithData = [...new Set(allRows.map((r) => r.model).filter((m): m is string => !!m))];
  const rows = sp.model ? allRows.filter((r) => r.model === sp.model) : allRows;
  const totalStaleValue = sp.model ? rows.reduce((s, r) => s + r.staleValue, 0) : totalAll;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Stale Stock</h1>
          <p className="text-sm text-ink-faint">
            On-hand inventory aged past the vendor&apos;s tolerance window — candidates for RTV. Default {defaultDays} days; per-vendor override via Vendor Master.
          </p>
        </div>
        <NewButton href="/rtv/new" label="+ New RTV" />
      </div>
      <StaleStockView
        rows={rows.map((r) => ({ ...r, oldestDate: r.oldestDate.toISOString(), layers: r.layers.map((l) => ({ ...l, date: l.date.toISOString() })) }))}
        totalStaleValue={totalStaleValue}
        vendors={vendors}
        models={models}
        modelsWithData={modelsWithData}
        initial={{ vendorId: sp.vendorId ?? "", model: sp.model ?? "" }}
      />
    </div>
  );
}
