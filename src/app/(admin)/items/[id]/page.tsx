import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { getActiveCompanyId } from "@/lib/company";
import { ItemForm } from "../ItemForm";

export const dynamic = "force-dynamic";

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

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const [item, vendors, categories, models] = await Promise.all([
    prisma.item.findFirst({
      where: { id, companyId },
      include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
    }),
    prisma.vendor.findMany({
      where: { companyId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, model: true },
    }),
    getCategoryOptions(companyId),
    getActiveModels(),
  ]);
  if (!item) notFound();

  const initial = {
    id: item.id,
    skuCode: item.skuCode,
    name: item.name,
    hsn: item.hsn,
    categoryId: item.categoryId,
    vendorId: item.vendorId,
    vendorSku: item.vendorSku,
    imageUrl: item.imageUrl,
    itemType: item.itemType,
    model: item.priceRevisions[0]?.model ?? null,
    transferPrice: item.priceRevisions[0]?.transferPrice ?? null,
    taxRate: item.priceRevisions[0]?.taxRate ?? null,
    effectiveDate: item.priceRevisions[0]?.effectiveDate ?? null,
  };

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-bold">Edit Item</h1>
      <p className="text-sm text-ink-faint mb-6">{item.skuCode} · {item.name}</p>
      <ItemForm vendors={vendors} categories={categories} models={models} initial={initial} />
    </div>
  );
}
