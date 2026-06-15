import Link from "next/link";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { buildMarginReport } from "@/lib/margin-report";
import { getActiveCompanyId } from "@/lib/company";
import { companyWhere } from "@/lib/scope";
import { MarginReportView } from "./MarginReportView";

export const dynamic = "force-dynamic";

export default async function MarginReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vendorId?: string; model?: string; marketplace?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const companyId = await getActiveCompanyId();
  const scope = await companyWhere();
  // Build without the model filter once to know which models actually have
  // margin data (for the always-visible buttons), then narrow for display.
  const [{ rows: rowsAll, totals: totalsAll }, vendors, models, rateCount] = await Promise.all([
    buildMarginReport({ companyId, month: sp.month, vendorId: sp.vendorId, marketplace: sp.marketplace }),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
    prisma.marketplaceRate.count({ where: scope }),
  ]);
  const modelsWithData = [...new Set(rowsAll.map((r) => r.model).filter((m): m is string => !!m))];
  const rows = sp.model ? rowsAll.filter((r) => r.model === sp.model) : rowsAll;
  const totals = sp.model
    ? rows.reduce(
        (t, r) => ({
          saleValue: t.saleValue + r.saleValue,
          netSale: t.netSale + r.netSale,
          commission: t.commission + r.commission,
          logistics: t.logistics + r.logistics,
          marketing: t.marketing + r.marketing,
          margin: t.margin + r.margin,
          cogs: t.cogs + r.transferPrice,
          netMargin: t.netMargin + r.netMargin,
        }),
        { saleValue: 0, netSale: 0, commission: 0, logistics: 0, marketing: 0, margin: 0, cogs: 0, netMargin: 0 },
      )
    : totalsAll;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Margin Report</h1>
        <p className="text-sm text-ink-faint">
          Net Sale − Commission − Logistics − Marketing − Other = Margin · less Transfer Price (COGS) = Net Margin · super-admin
        </p>
      </div>
      {rateCount === 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          No marketplace rates set — Commission &amp; Logistics will show 0. <Link href="/marketplace-rates" className="font-bold underline">Set rates</Link>.
        </div>
      )}
      <MarginReportView
        rows={rows}
        totals={totals}
        vendors={vendors}
        models={models}
        modelsWithData={modelsWithData}
        initial={{ month: sp.month ?? "", vendorId: sp.vendorId ?? "", model: sp.model ?? "", marketplace: sp.marketplace ?? "" }}
      />
    </div>
  );
}
