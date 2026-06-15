import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { toDisplayDate } from "@/lib/date";
import { ChevronLeft } from "lucide-react";
import { buildBatchSkuReport } from "@/lib/batch-report";
import { getActiveCompanyId } from "@/lib/company";
import { BatchSkuView } from "./BatchSkuView";

export const dynamic = "force-dynamic";

export default async function BatchSkuPage({ params }: { params: Promise<{ grnId: string }> }) {
  await requireAdmin();
  const { grnId } = await params;
  const companyId = await getActiveCompanyId();
  const { batch, rows } = await buildBatchSkuReport(companyId, grnId);
  if (!batch) notFound();

  return (
    <div>
      <div className="mb-6">
        <Link href="/batch-report" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Back to batches
        </Link>
        <h1 className="font-display text-3xl font-bold mt-1">Batch {batch.batchNo} — SKU-wise</h1>
        <p className="text-sm text-ink-faint">
          {batch.vendorName} · Inward {toDisplayDate(batch.inwardDate)}
          {batch.expiry && <> · Expiry {toDisplayDate(batch.expiry)}</>}
          {batch.warehouse && <> · {batch.warehouse}</>}
        </p>
      </div>
      <BatchSkuView batchNo={batch.batchNo} rows={rows} />
    </div>
  );
}
