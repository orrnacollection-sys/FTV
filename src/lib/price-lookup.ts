import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type ResolvedPrice = {
  transferPrice: number;
  taxRate: number;
  effectiveDate: Date;
  /// Model effective on this revision (null only for un-backfilled legacy rows).
  model: string | null;
} | null;

/**
 * Returns the price revision that was in effect for `itemId` on `asOfDate`.
 * Uses the latest revision with `effectiveDate <= asOfDate`. Returns null if no
 * revision exists on or before that date.
 */
export async function resolvePrice(
  itemId: string,
  asOfDate: Date,
  tx?: Prisma.TransactionClient,
): Promise<ResolvedPrice> {
  const client = tx ?? prisma;
  const rev = await client.itemPriceRevision.findFirst({
    where: { itemId, effectiveDate: { lte: asOfDate } },
    orderBy: { effectiveDate: "desc" },
    select: { transferPrice: true, taxRate: true, effectiveDate: true, model: true },
  });
  return rev ?? null;
}

/**
 * Batch version — resolves prices for many item+date pairs in one query per item.
 * For now O(items) round-trips; if it becomes hot we can rewrite as a single SQL.
 */
export async function resolvePrices(
  rows: { itemId: string; asOfDate: Date }[],
): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>();
  await Promise.all(
    rows.map(async (r, i) => {
      const p = await resolvePrice(r.itemId, r.asOfDate);
      out.set(`${i}:${r.itemId}`, p);
    }),
  );
  return out;
}
