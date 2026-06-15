import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveModels } from "@/lib/models";
import { ItemForm } from "../ItemForm";

async function getCategoryOptions() {
  const cats = await prisma.category.findMany({ orderBy: { name: "asc" } });
  // Build a path string for each category (Parent > Child).
  const byId = new Map(cats.map((c) => [c.id, c]));
  const path = (id: string): string => {
    const c = byId.get(id);
    if (!c) return "";
    return c.parentId ? `${path(c.parentId)} › ${c.name}` : c.name;
  };
  return cats.map((c) => ({ id: c.id, name: c.name, path: path(c.id) }));
}

export default async function NewItemPage() {
  const [vendors, categories, models] = await Promise.all([
    prisma.vendor.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, model: true },
    }),
    getCategoryOptions(),
    getActiveModels(),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-bold">New Item</h1>
      <p className="text-sm text-ink-faint mb-6">Add a SKU to the master.</p>
      {vendors.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You need at least one active vendor before creating an item.{" "}
          <Link href="/vendors/new" className="font-bold underline">Create one →</Link>
        </div>
      ) : (
        <ItemForm vendors={vendors} categories={categories} models={models} />
      )}
    </div>
  );
}
