import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { buildGSTR1 } from "@/lib/gst/gstr1";
import { defaultPeriod } from "@/lib/gst/period";
import { GSTR1View } from "./GSTR1View";

export const dynamic = "force-dynamic";

export default async function GSTR1Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; gstin?: string }>;
}) {
  await requireAdmin();
  const { period: periodParam, gstin: gstinParam } = await searchParams;
  const period = periodParam && /^\d{4}-\d{2}$/.test(periodParam) ? periodParam : defaultPeriod();

  const gstins = await prisma.companyGSTIN.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { gstin: true, state: true, isDefault: true },
  });

  const report = gstins.length > 0
    ? await buildGSTR1({ period, gstin: gstinParam || gstins[0].gstin })
    : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">GSTR-1 · Outward Supplies</h1>
        <p className="text-sm text-ink-faint">
          Monthly return of sales. Filed by the 11th of the next month. Covers Sections 4A (B2B),
          7 (B2CS), 9B (Credit/Debit Notes — Registered), and 12 (HSN Summary). Sections 5A, 6A,
          9C, and 13 will land in Phase 2.
        </p>
      </div>

      {gstins.length === 0 ? (
        <div className="card p-6 text-center text-ink-mid">
          No active CompanyGSTIN registrations.{" "}
          <a className="text-brand-yellow underline" href="/settings/company-profile">Set one up</a>{" "}
          to file GSTR-1.
        </div>
      ) : (
        <GSTR1View
          gstins={gstins}
          initialPeriod={period}
          initialGstin={gstinParam || gstins[0].gstin}
          initialReport={report ? serialize(report) : null}
        />
      )}
    </div>
  );
}

// Strip Date objects → ISO strings so the client component can rehydrate
// without RSC payload size complaints (and the client never imports Prisma).
function serialize(r: Awaited<ReturnType<typeof buildGSTR1>>) {
  return {
    ...r,
    generatedAt: r.generatedAt.toISOString(),
    b2b: r.b2b.map((i) => ({ ...i, invoiceDate: i.invoiceDate.toISOString() })),
    cdnr: r.cdnr.map((n) => ({
      ...n,
      noteDate: n.noteDate.toISOString(),
      originalInvoiceDate: n.originalInvoiceDate ? n.originalInvoiceDate.toISOString() : null,
    })),
  };
}
