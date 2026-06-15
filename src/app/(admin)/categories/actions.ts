"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { requireEditor } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";

type Result = { ok: true } | { ok?: undefined; error: string };

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export async function createCategory(fd: FormData): Promise<Result> {
  const name = String(fd.get("name") ?? "").trim();
  const parentId = String(fd.get("parentId") ?? "") || null;
  if (!name) return { error: "Name required" };
  const companyId = await getActiveCompanyId();
  try {
    await prisma.category.create({ data: { companyId, name, parentId } });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "Category already exists at this level" };
    }
    return { error: "Failed" };
  }
  revalidatePath("/categories");
  revalidatePath("/items");
  return { ok: true };
}

export async function updateCategory(id: string, fd: FormData): Promise<Result> {
  await requireEditor();
  const name = String(fd.get("name") ?? "").trim();
  const parentId = String(fd.get("parentId") ?? "") || null;
  if (!name) return { error: "Name required" };
  if (parentId === id) return { error: "A category can't be its own parent" };
  const companyId = await getActiveCompanyId();

  // The new parent (if any) must belong to the same company — multi-company safety.
  if (parentId) {
    const parentOk = await prisma.category.findFirst({ where: { id: parentId, companyId }, select: { id: true } });
    if (!parentOk) return { error: "Parent category not found" };
  }

  // Cycle guard: walking up from the new parent must never reach this category
  // (that would mean moving it under one of its own descendants).
  if (parentId) {
    let cur: string | null = parentId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === id) return { error: "Can't move a category under its own subcategory" };
      seen.add(cur);
      const p: { parentId: string | null } | null = await prisma.category.findUnique({ where: { id: cur }, select: { parentId: true } });
      cur = p?.parentId ?? null;
    }
  }

  try {
    // Scope the update by companyId so a category can only be edited within the
    // active company (multi-company safety). updateMany accepts the companyId
    // filter; count === 0 means it isn't this company's category.
    const res = await prisma.category.updateMany({ where: { id, companyId }, data: { name, parentId } });
    if (res.count === 0) return { error: "Category not found in this company" };
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "Category already exists at this level" };
    }
    return { error: "Failed" };
  }
  revalidatePath("/categories");
  revalidatePath("/items");
  return { ok: true };
}

export type CategoryImportResult = {
  created: number;
  errors: string[];
  errorRows?: Record<string, string>[];
};

/**
 * Bulk-import categories from CSV. Columns: `name`, `parent` (parent category
 * name — blank = top level). Tree-aware: resolves parents in multiple passes,
 * so a child can appear before its parent in the file. Existing (name, parent)
 * pairs are skipped (no duplicates). Bad rows come back in a downloadable
 * error report.
 */
export async function bulkImportCategories(rows: Record<string, string>[]): Promise<CategoryImportResult> {
  await requireEditor();
  if (rows.length === 0) return { created: 0, errors: ["No rows"] };
  if (rows.length > 10000) return { created: 0, errors: ["Batch too large — max 10000 rows"] };
  const companyId = await getActiveCompanyId();

  const existing = await prisma.category.findMany({ where: { companyId }, select: { id: true, name: true, parentId: true } });
  const nameToId = new Map<string, string>();
  for (const c of existing) {
    const k = c.name.trim().toLowerCase();
    if (!nameToId.has(k)) nameToId.set(k, c.id);
  }
  const existsKey = new Set(existing.map((c) => `${c.parentId ?? "ROOT"}|${c.name.trim().toLowerCase()}`));

  const errors: string[] = [];
  const errorRows: Record<string, string>[] = [];
  const fail = (rowNum: number, src: Record<string, string>, msg: string) => {
    errors.push(`Row ${rowNum}: ${msg}`);
    errorRows.push({ Row: String(rowNum), ...src, Error: msg });
  };

  type Draft = { name: string; parentName: string; rowNum: number; raw: Record<string, string> };
  let remaining: Draft[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (Object.values(r).every((v) => !v || !v.trim())) continue;
    const name = pick(r, "name", "Name", "Category", "category").trim();
    if (!name) { fail(rowNum, r, "Name required"); continue; }
    const parentName = pick(r, "parent", "Parent", "Parent Category", "parentName").trim();
    remaining.push({ name, parentName, rowNum, raw: r });
  }

  let created = 0;
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    const next: Draft[] = [];
    for (const d of remaining) {
      let parentId: string | null = null;
      if (d.parentName) {
        const pid = nameToId.get(d.parentName.toLowerCase());
        if (!pid) { next.push(d); continue; } // parent not available yet — retry next pass
        parentId = pid;
      }
      const key = `${parentId ?? "ROOT"}|${d.name.toLowerCase()}`;
      if (existsKey.has(key)) { progress = true; continue; } // already exists — skip silently
      try {
        const c = await prisma.category.create({ data: { companyId, name: d.name, parentId } });
        if (!nameToId.has(d.name.toLowerCase())) nameToId.set(d.name.toLowerCase(), c.id);
        existsKey.add(key);
        created++;
        progress = true;
      } catch {
        existsKey.add(key);
        progress = true;
      }
    }
    remaining = next;
  }
  for (const d of remaining) fail(d.rowNum, d.raw, `parent "${d.parentName}" not found`);

  if (created > 0) await logWrite("Category", "bulk", "CREATE", null, { created });
  revalidatePath("/categories");
  revalidatePath("/items");
  return { created, errors, errorRows };
}

export async function deleteCategory(id: string): Promise<Result> {
  const companyId = await getActiveCompanyId();
  const childCount = await prisma.category.count({ where: { companyId, parentId: id } });
  const itemCount = await prisma.item.count({ where: { companyId, categoryId: id } });
  if (childCount > 0) return { error: "Has subcategories — remove them first" };
  if (itemCount > 0) return { error: `Used by ${itemCount} item(s)` };
  // Scope by companyId — only delete within the active company (multi-company safety).
  await prisma.category.deleteMany({ where: { id, companyId } });
  revalidatePath("/categories");
  revalidatePath("/items");
  return { ok: true };
}
