import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { HsnRateManager } from "./HsnRateManager";

export const dynamic = "force-dynamic";

export default async function HsnRatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; supplyType?: string; active?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const supplyType = sp?.supplyType?.trim();
  const active = sp?.active?.trim();

  const rates = await prisma.hsnRate.findMany({
    where: {
      ...(supplyType ? { supplyType } : {}),
      ...(active === "yes" ? { isActive: true } : active === "no" ? { isActive: false } : {}),
      ...(q
        ? {
            OR: [
              { hsn: { contains: q } },
              { description: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ hsn: "asc" }, { effectiveFrom: "desc" }],
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">HSN / SAC Rates</h1>
          <p className="text-sm text-ink-faint max-w-2xl">
            HSN → GST slab + cess, effective-dated. Picked at transaction time
            by the tax resolver. Add a new row whenever the GST council changes
            a rate — old rows stay for historical transactions.
          </p>
        </div>
        <Link href="/tax/components" className="btn-secondary">
          Tax Components →
        </Link>
      </div>
      <HsnRateManager
        rates={rates.map((r) => ({
          id: r.id,
          hsn: r.hsn,
          description: r.description,
          slabRate: r.slabRate,
          cessRate: r.cessRate,
          supplyType: r.supplyType,
          isReverseCharge: r.isReverseCharge,
          effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
          notes: r.notes,
          isActive: r.isActive,
        }))}
        initialQuery={q ?? ""}
        initialSupplyType={supplyType ?? ""}
        initialActive={active ?? ""}
      />
    </div>
  );
}
