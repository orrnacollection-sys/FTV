import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { CategoryManager } from "./CategoryManager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const scope = await companyWhere();
  const cats = await prisma.category.findMany({
    where: scope,
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true, children: true } } },
  });

  const rows = cats.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    itemCount: c._count.items,
    childCount: c._count.children,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Categories</h1>
        <p className="text-sm text-ink-faint">Hierarchy used to organize SKUs.</p>
      </div>
      <CategoryManager rows={rows} />
    </div>
  );
}
