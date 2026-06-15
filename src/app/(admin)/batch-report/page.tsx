import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveModels } from "@/lib/models";
import { parseFlexibleDate, addDays } from "@/lib/date";
import { buildBatchSummary } from "@/lib/batch-report";
import { getActiveCompanyId } from "@/lib/company";
import { companyWhere } from "@/lib/scope";
import { BatchReportView } from "./BatchReportView";

export const dynamic = "force-dynamic";

export default async function BatchReportPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; model?: string; vendorId?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const companyId = await getActiveCompanyId();
  const scope = await companyWhere();

  const [all, vendors, models] = await Promise.all([
    buildBatchSummary(companyId),
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
  ]);

  const q = sp.q?.trim().toLowerCase();
  const from = sp.from ? parseFlexibleDate(sp.from) : null;
  const to = sp.to ? parseFlexibleDate(sp.to) : null;
  const toExcl = to ? addDays(to, 1) : null;

  const rows = all.filter((r) => {
    if (sp.model && r.model !== sp.model) return false;
    if (sp.vendorId && r.vendorId !== sp.vendorId) return false;
    if (q && !(`${r.batchNo} ${r.vendorName} ${r.vendorCode ?? ""}`.toLowerCase().includes(q))) return false;
    if (from && r.inwardDate < from) return false;
    if (toExcl && r.inwardDate >= toExcl) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Batch Summary Report</h1>
        <p className="text-sm text-ink-faint">
          One row per batch (GRN receipt). Sales are allocated to batches oldest-expiry-first (FIFO). Click View for the SKU-wise breakdown.
        </p>
      </div>
      <BatchReportView
        rows={rows}
        vendors={vendors}
        models={models}
        initial={{ q: sp.q ?? "", model: sp.model ?? "", vendorId: sp.vendorId ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
      />
    </div>
  );
}
