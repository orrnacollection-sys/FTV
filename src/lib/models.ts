import { prisma } from "@/lib/db";
import { MODELS, MODEL_LABELS } from "@/lib/constants";

export type ModelOption = { code: string; label: string };

/**
 * Active models for dropdowns, sourced from the ModelMaster table.
 * Falls back to the canonical MODELS const if the table is empty/unavailable,
 * so the UI never ends up with zero options.
 */
export async function getActiveModels(): Promise<ModelOption[]> {
  try {
    const rows = await prisma.modelMaster.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, label: true },
    });
    if (rows.length > 0) return rows;
  } catch {
    // fall through to const
  }
  return MODELS.map((c) => ({ code: c, label: MODEL_LABELS[c] }));
}

/**
 * True if `code` is an assignable model. Checks ModelMaster (active rows);
 * falls back to the canonical MODELS const if the table is empty/unavailable,
 * matching the options shown by getActiveModels().
 */
export async function isValidModel(code: string): Promise<boolean> {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return false;
  try {
    const count = await prisma.modelMaster.count();
    if (count > 0) {
      const hit = await prisma.modelMaster.count({ where: { code: wanted, isActive: true } });
      return hit > 0;
    }
  } catch {
    // fall through to const
  }
  return (MODELS as readonly string[]).includes(wanted);
}
