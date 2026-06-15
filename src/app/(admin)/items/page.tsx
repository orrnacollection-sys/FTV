import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { getActiveModels } from "@/lib/models";
import { NewButton } from "@/components/NewButton";
import { ItemTable } from "./ItemTable";

const PAGE_SIZE = 50;

async function getCategoryOptions(companyId: string) {
  const cats = await prisma.category.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const path = (id: string): string => {
    const c = byId.get(id);
    if (!c) return "";
    return c.parentId ? `${path(c.parentId)} › ${c.name}` : c.name;
  };
  return cats.map((c) => ({ id: c.id, name: c.name, path: path(c.id) }));
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoryId?: string; vendorId?: string; model?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const page = Math.max(1, parseInt(sp?.page ?? "1", 10) || 1);
  const companyId = await getActiveCompanyId();

  const where: Record<string, unknown> = { companyId };
  if (q) {
    where.OR = [
      { skuCode: { contains: q } },
      { name: { contains: q } },
      { hsn: { contains: q } },
      { vendor: { name: { contains: q } } },
      { vendor: { code: { contains: q } } },
    ];
  }
  if (sp.categoryId) where.categoryId = sp.categoryId;
  if (sp.vendorId) where.vendorId = sp.vendorId;
  if (sp.model) where.vendor = { model: sp.model };

  // One page only (server-side pagination). count() gives the total for the pager.
  const [items, total, categories, vendors, models] = await Promise.all([
    prisma.item.findMany({
      where,
      include: {
        vendor: { select: { code: true, name: true, model: true } },
        category: { select: { name: true } },
        priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 },
      },
      orderBy: { skuCode: "asc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.item.count({ where }),
    getCategoryOptions(companyId),
    prisma.vendor.findMany({ where: { companyId }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = items.map((it) => ({
    id: it.id,
    skuCode: it.skuCode,
    name: it.name,
    hsn: it.hsn,
    imageUrl: it.imageUrl,
    itemType: it.itemType,
    model: it.priceRevisions[0]?.model ?? it.vendor.model,
    vendorCode: it.vendor.code,
    vendorName: it.vendor.name,
    categoryName: it.category?.name ?? null,
    transferPrice: it.priceRevisions[0]?.transferPrice ?? null,
    taxRate: it.priceRevisions[0]?.taxRate ?? null,
    effectiveDate: it.priceRevisions[0]?.effectiveDate ?? null,
  }));

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Item Master</h1>
          <p className="text-sm text-ink-faint">
            {total.toLocaleString("en-IN")} SKU{total === 1 ? "" : "s"}
            {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""} · latest rate per SKU
          </p>
        </div>
        <NewButton href="/items/new" label="+ New item" />
      </div>
      <ItemTable
        rows={rows}
        categories={categories}
        vendors={vendors}
        models={models}
        total={total}
        page={page}
        pageCount={pageCount}
        initial={{
          q: q ?? "",
          categoryId: sp.categoryId ?? "",
          vendorId: sp.vendorId ?? "",
          model: sp.model ?? "",
        }}
      />
    </div>
  );
}
