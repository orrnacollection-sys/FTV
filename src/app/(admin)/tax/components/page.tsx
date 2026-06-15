import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { TaxComponentTable } from "./TaxComponentTable";

export const dynamic = "force-dynamic";

export default async function TaxComponentsPage() {
  await requireAdmin();
  const components = await prisma.taxComponent.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Tax Components</h1>
        <p className="text-sm text-ink-faint">
          Canonical Indian GST taxonomy — defined by tax law, seeded once.
          You can enable/disable per component or rename the display label,
          but the codes and scope rules are fixed.
        </p>
      </div>
      <TaxComponentTable rows={components.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        family: c.family,
        chargeType: c.chargeType,
        scope: c.scope,
        slabFraction: c.slabFraction,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
      }))} />
    </div>
  );
}
