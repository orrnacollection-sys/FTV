import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Stamp `companyId = <primary company>` on every operational row where it is
 * currently NULL. Single-company posture: all unscoped data belongs to the one
 * primary company (Adwitiya). Admin pages filter by companyId, so rows left NULL
 * are invisible there even though the vendor portal (vendorId-scoped) shows them.
 *
 * ONLY the companyId tag is written — no amount, qty, rate, or date is touched —
 * so balances and reports are unchanged; previously-empty admin lists just start
 * showing the correct, already-existing numbers.
 *
 * Discovers the target tables from the Prisma schema (DMMF) so it can never miss
 * one. Idempotent: re-running stamps nothing once everything is scoped.
 */
export async function stampCompanyId(
  prisma: PrismaClient,
): Promise<{ model: string; count: number }[]> {
  const primary = await prisma.company.findFirst({
    where: { isPrimary: true, isActive: true },
    select: { id: true },
  });
  if (!primary) throw new Error("No primary company found — run `pnpm db:seed` first.");

  // Every model that owns a nullable companyId discriminator.
  const models = Prisma.dmmf.datamodel.models.filter((m) =>
    m.fields.some((f) => f.name === "companyId"),
  );

  const results: { model: string; count: number }[] = [];
  for (const m of models) {
    const key = m.name.charAt(0).toLowerCase() + m.name.slice(1); // GRN -> gRN
    const delegate = (prisma as unknown as Record<
      string,
      { updateMany?: (args: unknown) => Promise<{ count: number }> }
    >)[key];
    if (!delegate?.updateMany) continue;
    try {
      const res = await delegate.updateMany({
        where: { companyId: null },
        data: { companyId: primary.id },
      });
      if (res.count > 0) results.push({ model: m.name, count: res.count });
    } catch {
      // A model may expose companyId as required (e.g. join tables) — its NULL
      // filter simply matches nothing. Ignore and move on.
    }
  }
  return results;
}
