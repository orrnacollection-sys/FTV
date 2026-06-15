import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { MarketingCostView } from "./MarketingCostView";

export const dynamic = "force-dynamic";

export default async function MarketingCostPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; month?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const where: Record<string, unknown> = { ...scope };
  if (sp.month) where.month = sp.month;
  if (sp.q) where.item = { OR: [{ skuCode: { contains: sp.q } }, { name: { contains: sp.q } }] };

  const costs = await prisma.marketingCost.findMany({
    where,
    include: { item: { select: { skuCode: true, name: true } } },
    orderBy: [{ month: "desc" }, { item: { skuCode: "asc" } }],
    take: 2000,
  });

  const rows = costs.map((c) => ({
    id: c.id,
    month: c.month,
    skuCode: c.item.skuCode,
    itemName: c.item.name,
    amount: c.amount,
  }));

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Marketing Cost</h1>
        <p className="text-sm text-ink-faint">Marketing spend per SKU per month · feeds the Margin Report</p>
      </div>
      <MarketingCostView rows={rows} total={total} initial={{ q: sp.q ?? "", month: sp.month ?? "" }} />
    </div>
  );
}
