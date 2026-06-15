"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";

const schema = z.object({
  id: z.string().min(1),
  prefix: z.string().trim().max(10),
  padding: z.coerce.number().int().min(1).max(10),
  nextNumber: z.coerce.number().int().min(1),
});

type Result = { ok: true } | { error: string; fieldErrors?: Record<string, string> };

export async function updateSeries(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = schema.safeParse({
    id: String(fd.get("id") ?? ""),
    prefix: String(fd.get("prefix") ?? ""),
    padding: String(fd.get("padding") ?? "0"),
    nextNumber: String(fd.get("nextNumber") ?? "0"),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const before = await prisma.series.findUnique({ where: { id: parsed.data.id } });
  if (!before) return { error: "Series not found" };
  if (parsed.data.nextNumber < before.nextNumber) {
    return {
      error: `nextNumber cannot decrease (current ${before.nextNumber}). Decreasing risks duplicate document numbers.`,
      fieldErrors: { nextNumber: `must be ≥ ${before.nextNumber}` },
    };
  }
  const after = await prisma.series.update({
    where: { id: parsed.data.id },
    data: {
      prefix: parsed.data.prefix,
      padding: parsed.data.padding,
      nextNumber: parsed.data.nextNumber,
    },
  });
  await logWrite("Series", parsed.data.id, "UPDATE", before, after);
  revalidatePath("/settings/series");
  return { ok: true };
}
