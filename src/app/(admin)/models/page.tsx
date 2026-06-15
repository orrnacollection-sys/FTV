import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { ModelPanel } from "./ModelPanel";

export default async function ModelsPage() {
  await requireAdmin();
  const models = await prisma.modelMaster.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Model Master</h1>
        <p className="text-sm text-ink-faint">
          Business models used in Vendor Master. Create, edit and deactivate models, and set return policy per model.
        </p>
      </div>
      <ModelPanel
        rows={models.map((m) => ({
          id: m.id,
          code: m.code,
          label: m.label,
          remarks: m.remarks,
          returnPolicy: m.returnPolicy,
          isActive: m.isActive,
          sortOrder: m.sortOrder,
        }))}
      />
    </div>
  );
}
