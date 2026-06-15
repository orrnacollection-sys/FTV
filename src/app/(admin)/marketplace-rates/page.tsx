import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { MarketplaceRatesView } from "./MarketplaceRatesView";

export const dynamic = "force-dynamic";

export default async function MarketplaceRatesPage() {
  await requireAdmin();
  const scope = await companyWhere();
  const rates = await prisma.marketplaceRate.findMany({ where: scope, orderBy: { marketplace: "asc" } });
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Marketplace Rates</h1>
        <p className="text-sm text-ink-faint">Commission % and logistics % per marketplace — used to derive those costs in the Margin Report.</p>
      </div>
      <MarketplaceRatesView
        rates={rates.map((r) => ({ id: r.id, marketplace: r.marketplace, commissionPct: r.commissionPct, logisticsPct: r.logisticsPct }))}
      />
    </div>
  );
}
