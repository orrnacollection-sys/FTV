import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { NewButton } from "@/components/NewButton";
import { GRNTable } from "../grn/GRNTable";

export const dynamic = "force-dynamic";

export default async function RfvListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const scope = await companyWhere();

  // Scoped to Reject-In / Return-From-Vendor documents only. Drafts live on
  // the main /grn list under the Drafts tab.
  const grns = await prisma.gRN.findMany({
    where: {
      ...scope,
      type: "RFV",
      isDraft: false,
      ...(q
        ? {
            OR: [
              { grnNo: { contains: q } },
              { vendorInvoiceNo: { contains: q } },
              { vendor: { name: { contains: q } } },
              { vendor: { code: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { code: true, name: true } },
      items: { select: { qty: true, rejectedQty: true } },
    },
    orderBy: { grnDate: "desc" },
  });

  const rows = grns.map((g) => {
    const acceptedQty = g.items.reduce((s, i) => s + (i.qty - i.rejectedQty), 0);
    return {
      id: g.id,
      grnNo: g.grnNo,
      grnDate: g.grnDate,
      type: g.type,
      vendorCode: g.vendor.code,
      vendorName: g.vendor.name,
      vendorInvoiceNo: g.vendorInvoiceNo,
      total: g.total,
      acceptedQty,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Reject-In / RFV</h1>
          <p className="text-sm text-ink-faint">
            Return-from-Vendor documents — goods received back from the vendor. These increase inventory (and credit OR vendors).
          </p>
        </div>
        <NewButton href="/rfv/new" label="+ New RFV" />
      </div>
      <GRNTable rows={rows} initialQuery={q ?? ""} initialType="RFV" lockType />
    </div>
  );
}
