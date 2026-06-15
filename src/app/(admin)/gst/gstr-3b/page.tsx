import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { buildGSTR3B } from "@/lib/gst/gstr3b";
import { defaultPeriod, periodLabel } from "@/lib/gst/period";
import { GSTR3BView } from "./GSTR3BView";

export const dynamic = "force-dynamic";

export default async function GSTR3BPage({
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
    ? await buildGSTR3B({ period, gstin: gstinParam || gstins[0].gstin })
    : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">GSTR-3B · Summary Return</h1>
        <p className="text-sm text-ink-faint">
          Self-declared monthly summary filed by the 20th. Auto-fills Section 3.1(a) + 3.1(c)
          (outward), 3.2 (inter-state UR), and 4(A5) (ITC from REGULAR-vendor GRNs). Use these
          numbers when filing on the portal — admin overrides happen there for now.
          {report && <> · Period: <span className="font-bold">{periodLabel(report.period)}</span></>}
        </p>
      </div>

      {gstins.length === 0 ? (
        <div className="card p-6 text-center text-ink-mid">
          No active CompanyGSTIN registrations. Set one up under Settings → Company Profile.
        </div>
      ) : (
        <GSTR3BView
          gstins={gstins}
          initialPeriod={period}
          initialGstin={gstinParam || gstins[0].gstin}
          report={report ? serialize(report) : null}
        />
      )}
    </div>
  );
}

function serialize(r: Awaited<ReturnType<typeof buildGSTR3B>>) {
  return { ...r, generatedAt: r.generatedAt.toISOString() };
}
