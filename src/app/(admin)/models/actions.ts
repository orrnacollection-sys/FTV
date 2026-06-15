"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

const baseFields = {
  label: z.string().trim().min(1, "Label required").max(60),
  remarks: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  returnPolicy: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  isActive: z.coerce.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(999),
};

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,29}$/, "Code: letters/digits/underscore, start with a letter"),
  ...baseFields,
});

const updateSchema = z.object({ id: z.string().min(1), ...baseFields });

function fieldErrors(e: z.ZodError) {
  return Object.fromEntries(
    Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
  );
}

function readBase(fd: FormData) {
  return {
    label: String(fd.get("label") ?? ""),
    remarks: String(fd.get("remarks") ?? ""),
    returnPolicy: String(fd.get("returnPolicy") ?? ""),
    isActive: fd.get("isActive") === "on" || fd.get("isActive") === "true",
    sortOrder: String(fd.get("sortOrder") ?? "0"),
  };
}

export async function createModel(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = createSchema.safeParse({ code: String(fd.get("code") ?? ""), ...readBase(fd) });
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const existing = await prisma.modelMaster.findUnique({ where: { code: parsed.data.code } });
  if (existing) return { error: `Model code "${parsed.data.code}" already exists`, fieldErrors: { code: "Already exists" } };

  const created = await prisma.modelMaster.create({
    data: {
      code: parsed.data.code,
      label: parsed.data.label,
      remarks: parsed.data.remarks ?? null,
      returnPolicy: parsed.data.returnPolicy ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
    },
  });
  await logWrite("ModelMaster", created.id, "CREATE", null, created);
  revalidatePath("/models");
  revalidatePath("/vendors");
  return { ok: true };
}

export async function updateModel(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = updateSchema.safeParse({ id: String(fd.get("id") ?? ""), ...readBase(fd) });
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const before = await prisma.modelMaster.findUnique({ where: { id: parsed.data.id } });
  if (!before) return { error: "Model not found" };

  // Don't let the last active model be deactivated.
  if (before.isActive && !parsed.data.isActive) {
    const otherActive = await prisma.modelMaster.count({ where: { isActive: true, id: { not: parsed.data.id } } });
    if (otherActive < 1) return { error: "At least one model must stay active" };
  }

  const after = await prisma.modelMaster.update({
    where: { id: parsed.data.id },
    data: {
      label: parsed.data.label,
      remarks: parsed.data.remarks ?? null,
      returnPolicy: parsed.data.returnPolicy ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
    },
  });
  await logWrite("ModelMaster", parsed.data.id, "UPDATE", before, after);
  revalidatePath("/models");
  revalidatePath("/vendors");
  return { ok: true };
}

export async function deleteModel(id: string): Promise<Result> {
  await requireAdmin();
  const m = await prisma.modelMaster.findUnique({ where: { id } });
  if (!m) return { error: "Model not found" };

  // Block delete if any vendor still uses this model code.
  const inUse = await prisma.vendor.count({ where: { model: m.code } });
  if (inUse > 0) return { error: `Used by ${inUse} vendor(s) — deactivate it instead` };

  await prisma.modelMaster.delete({ where: { id } });
  await logWrite("ModelMaster", id, "DELETE", m, null);
  revalidatePath("/models");
  revalidatePath("/vendors");
  return { ok: true };
}
