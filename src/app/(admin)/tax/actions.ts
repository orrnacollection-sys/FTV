"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { hsnRateSchema, taxComponentEditSchema } from "@/lib/validators/tax";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(e: import("zod").ZodError) {
  return Object.fromEntries(
    Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
  );
}

function rawToObj(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) o[k] = String(v);
  return o;
}

// ── HSN → Rate CRUD ──────────────────────────────────────────────────────────

export async function createHsnRate(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = hsnRateSchema.safeParse(rawToObj(fd));
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  let id = "";
  try {
    const created = await prisma.hsnRate.create({
      data: {
        hsn: parsed.data.hsn,
        description: parsed.data.description,
        slabRate: parsed.data.slabRate,
        cessRate: parsed.data.cessRate ?? 0,
        supplyType: parsed.data.supplyType,
        isReverseCharge: parsed.data.isReverseCharge,
        effectiveFrom: parsed.data.effectiveFrom,
        notes: parsed.data.notes ?? null,
        isActive: parsed.data.isActive,
      },
    });
    id = created.id;
  } catch {
    return { error: "Failed to add HSN rate" };
  }
  await logWrite("HsnRate", id, "CREATE", null, parsed.data);
  revalidatePath("/tax/hsn-rates");
  return { ok: true };
}

export async function updateHsnRate(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = hsnRateSchema.safeParse(rawToObj(fd));
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const before = await prisma.hsnRate.findUnique({ where: { id } });
  if (!before) return { error: "HSN rate not found" };

  await prisma.hsnRate.update({
    where: { id },
    data: {
      hsn: parsed.data.hsn,
      description: parsed.data.description,
      slabRate: parsed.data.slabRate,
      cessRate: parsed.data.cessRate ?? 0,
      supplyType: parsed.data.supplyType,
      isReverseCharge: parsed.data.isReverseCharge,
      effectiveFrom: parsed.data.effectiveFrom,
      notes: parsed.data.notes ?? null,
      isActive: parsed.data.isActive,
    },
  });
  await logWrite("HsnRate", id, "UPDATE", before, parsed.data);
  revalidatePath("/tax/hsn-rates");
  return { ok: true };
}

export async function deleteHsnRate(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.hsnRate.findUnique({ where: { id } });
  if (!before) return { error: "HSN rate not found" };
  await prisma.hsnRate.delete({ where: { id } });
  await logWrite("HsnRate", id, "DELETE", before, null);
  revalidatePath("/tax/hsn-rates");
  return { ok: true };
}

// ── TaxComponent edit (limited — only name/active/sortOrder editable) ────────

export async function updateTaxComponent(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = taxComponentEditSchema.safeParse(rawToObj(fd));
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };

  const before = await prisma.taxComponent.findUnique({ where: { id } });
  if (!before) return { error: "Tax component not found" };

  await prisma.taxComponent.update({
    where: { id },
    data: {
      name: parsed.data.name,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });
  await logWrite("TaxComponent", id, "UPDATE", before, parsed.data);
  revalidatePath("/tax/components");
  return { ok: true };
}
