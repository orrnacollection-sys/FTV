import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getItcSummary } from "@/lib/gst/itc";
import { monthRange, defaultPeriod } from "@/lib/gst/period";
import { ItcReconciliationView } from "./ItcReconciliationView";

export const dynamic = "force-dynamic";

export default async function ItcReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; gstin?: string }>;
}) {
  await requireAdmin();
  const { period: pParam, gstin: gParam } = await searchParams;

  const gstins = await prisma.companyGSTIN.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { gstin: true, state: true, isDefault: true },
  });
  if (gstins.length === 0) {
    return (
      <div>
        <h1 className="font-display text-3xl font-bold mb-4">ITC Reconciliation</h1>
        <div className="card p-6 text-center text-ink-mid">No active CompanyGSTIN.</div>
      </div>
    );
  }
  const period = pParam && /^\d{4}-\d{2}$/.test(pParam) ? pParam : defaultPeriod();
  const filingGstin = gParam && gstins.find((g) => g.gstin === gParam) ? gParam : gstins[0].gstin;
  const { from, to } = monthRange(period);
  const toInclusive = new Date(to.getTime() - 1);

  const [summary, lines, unmatchedGrns] = await Promise.all([
    getItcSummary({ filingGstin, period, from, to: toInclusive }),
    prisma.gSTR2BLine.findMany({
      where: { filingGstin, period },
      orderBy: [{ vendorGstin: "asc" }, { invoiceDate: "asc" }],
      include: { matchedGrn: { select: { id: true, grnNo: true, grnDate: true, total: true } } },
    }),
    // Unmatched GRNs in the period for the picker + the "missing in portal" list.
    prisma.gRN.findMany({
      where: {
        grnDate: { gte: from, lt: to },
        isDraft: false,
        type: "PURCHASE",
        vendor: { gstRegType: "REGULAR" },
        matchedItc2bLineId: null,
      },
      orderBy: { grnDate: "asc" },
      include: {
        vendor: { select: { name: true, gst: true } },
        items: { select: { taxableValue: true, tax: true } },
      },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">ITC Reconciliation · GSTR-2B vs GRNs</h1>
        <p className="text-sm text-ink-faint">
          Upload the GSTR-2B file you downloaded from the portal (JSON or CSV) for the period,
          then auto-match against your recorded GRNs. Eligible ITC = sum of MATCHED line taxes.
        </p>
      </div>

      <ItcReconciliationView
        gstins={gstins}
        initialPeriod={period}
        initialGstin={filingGstin}
        summary={summary}
        lines={lines.map((l) => ({
          id: l.id,
          vendorGstin: l.vendorGstin,
          vendorName: l.vendorName,
          invoiceNo: l.invoiceNo,
          invoiceDate: l.invoiceDate.toISOString(),
          invoiceType: l.invoiceType,
          invoiceValue: l.invoiceValue,
          taxableValue: l.taxableValue,
          cgst: l.cgst,
          sgst: l.sgst,
          igst: l.igst,
          cess: l.cess,
          matchStatus: l.matchStatus,
          matchedGrn: l.matchedGrn
            ? {
                id: l.matchedGrn.id,
                grnNo: l.matchedGrn.grnNo,
                grnDate: l.matchedGrn.grnDate.toISOString(),
                total: l.matchedGrn.total,
              }
            : null,
        }))}
        unmatchedGrns={unmatchedGrns.map((g) => {
          const tax = g.items.reduce((s, it) => s + it.tax, 0);
          const taxable = g.items.reduce((s, it) => s + it.taxableValue, 0);
          return {
            id: g.id,
            grnNo: g.grnNo,
            grnDate: g.grnDate.toISOString(),
            vendorInvoiceNo: g.vendorInvoiceNo,
            vendorInvoiceDate: g.vendorInvoiceDate ? g.vendorInvoiceDate.toISOString() : null,
            total: g.total,
            taxable,
            tax,
            vendorName: g.vendor.name,
            vendorGstin: g.vendor.gst,
          };
        })}
      />
    </div>
  );
}
