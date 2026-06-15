import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveModels } from "@/lib/models";
import { companyWhere } from "@/lib/scope";
import { OtherChargesView } from "./OtherChargesView";

export const dynamic = "force-dynamic";

export default async function OtherChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const [vendors, models, charges] = await Promise.all([
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    getActiveModels(),
    prisma.otherCharge.findMany({
      where: { ...scope, ...(sp.vendorId ? { vendorId: sp.vendorId } : {}) },
      include: { vendor: { select: { code: true, name: true } } },
      orderBy: { date: "desc" },
      take: 1000,
    }),
  ]);

  const rows = charges.map((c) => ({
    id: c.id,
    chargeNo: c.chargeNo,
    date: c.date,
    direction: c.direction,
    model: c.model,
    vendorCode: c.vendor.code,
    vendorName: c.vendor.name,
    reason: c.reason,
    taxable: c.taxable,
    gstRate: c.gstRate,
    gst: c.gst,
    total: c.total,
    notes: c.notes,
  }));

  const debitTotal = rows.filter((r) => r.direction !== "CREDIT").reduce((s, r) => s + r.total, 0);
  const creditTotal = rows.filter((r) => r.direction === "CREDIT").reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Journal</h1>
        <p className="text-sm text-ink-faint">
          Adhoc debit / credit entries against vendors. Debit Note reduces what we owe; Credit Note increases it.
          Each posts to the vendor ledger under its model. Customer-side journal entries will land here too when the
          Banking module ships (#124).
        </p>
      </div>
      <OtherChargesView
        vendors={vendors}
        models={models}
        rows={rows}
        debitTotal={debitTotal}
        creditTotal={creditTotal}
        initialVendorId={sp.vendorId ?? ""}
      />
    </div>
  );
}
