import Link from "next/link";
import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { NewButton } from "@/components/NewButton";
import { GRNTable } from "./GRNTable";
import { GRNImportButtons } from "./GRNImportButtons";

export const dynamic = "force-dynamic";

export default async function GRNListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const type = sp?.type?.trim();
  const isDraftView = sp?.view === "drafts";
  const scope = await companyWhere();

  const [grns, draftCount] = await Promise.all([
    prisma.gRN.findMany({
    where: {
      ...scope,
      isDraft: isDraftView,
      ...(type ? { type } : {}),
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
    }),
    prisma.gRN.count({ where: { ...scope, isDraft: true } }),
  ]);

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
          <h1 className="font-display text-3xl font-bold">GRN / Purchase</h1>
          <p className="text-sm text-ink-faint">
            {rows.length} {isDraftView ? "draft" : "document"}{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/grn" className={`rounded-full px-3 py-1 text-xs font-bold ${!isDraftView ? "bg-brand-black text-white" : "bg-surface-muted text-ink-mid hover:bg-brand-yellow-50"}`}>Posted</Link>
          <Link href="/grn?view=drafts" className={`rounded-full px-3 py-1 text-xs font-bold ${isDraftView ? "bg-brand-black text-white" : draftCount > 0 ? "bg-brand-yellow-pale text-brand-yellow-dark hover:bg-brand-yellow-light" : "bg-surface-muted text-ink-faint hover:bg-brand-yellow-50"}`}>
            Drafts {draftCount > 0 ? `(${draftCount})` : "∅"}
          </Link>
          <GRNImportButtons />
          <NewButton href="/grn/new" label="+ New GRN" />
        </div>
      </div>
      <GRNTable rows={rows} initialQuery={q ?? ""} initialType={type ?? ""} />
    </div>
  );
}
