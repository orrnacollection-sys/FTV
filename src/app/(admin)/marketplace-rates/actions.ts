"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";

type Result = { ok: true } | { error: string };

export async function saveMarketplaceRate(input: {
  marketplace: string;
  commissionPct: number;
  logisticsPct: number;
}): Promise<Result> {
  await requireAdmin();
  const marketplace = (input.marketplace ?? "").trim();
  if (!marketplace) return { error: "Marketplace name required" };
  const commissionPct = Number.isFinite(input.commissionPct) ? input.commissionPct : 0;
  const logisticsPct = Number.isFinite(input.logisticsPct) ? input.logisticsPct : 0;
  if (commissionPct < 0 || logisticsPct < 0) return { error: "Rates cannot be negative" };

  await prisma.marketplaceRate.upsert({
    where: { marketplace },
    update: { commissionPct, logisticsPct },
    create: { marketplace, commissionPct, logisticsPct },
  });
  await logWrite("MarketplaceRate", marketplace, "UPDATE", null, { commissionPct, logisticsPct });
  revalidatePath("/marketplace-rates");
  return { ok: true };
}

export async function deleteMarketplaceRate(id: string): Promise<Result> {
  await requireAdmin();
  try {
    await prisma.marketplaceRate.delete({ where: { id } });
    await logWrite("MarketplaceRate", id, "DELETE", null, null);
    revalidatePath("/marketplace-rates");
    return { ok: true };
  } catch {
    return { error: "Failed to delete" };
  }
}
