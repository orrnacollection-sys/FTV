import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { companyWhere } from "@/lib/scope";
import { SeriesTable } from "./SeriesTable";

export const dynamic = "force-dynamic";

export default async function SeriesPage() {
  await requireAdmin();
  const scope = await companyWhere();
  const series = await prisma.series.findMany({ where: scope, orderBy: { docType: "asc" } });
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Document Series</h1>
        <p className="text-sm text-ink-faint">Customize prefix and numbering per document type.</p>
      </div>
      <SeriesTable
        rows={series.map((s) => ({
          id: s.id,
          docType: s.docType,
          prefix: s.prefix,
          padding: s.padding,
          nextNumber: s.nextNumber,
        }))}
      />
    </div>
  );
}
