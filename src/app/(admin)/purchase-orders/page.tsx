import Link from "next/link";
import { prisma } from "@/lib/db";
import { companyWhere } from "@/lib/scope";
import { NewButton } from "@/components/NewButton";
import { POTable } from "./POTable";

export const dynamic = "force-dynamic";

export default async function POListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const status = sp?.status?.trim();
  const isDraftView = sp?.view === "drafts";
  const scope = await companyWhere();

  const [pos, draftCount] = await Promise.all([
    prisma.purchaseOrder.findMany({
    where: {
      ...scope,
      isDraft: isDraftView,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { poNumber: { contains: q } },
              { vendor: { name: { contains: q } } },
              { vendor: { code: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { code: true, name: true } },
      items: { select: { qty: true, receivedQty: true } },
    },
    orderBy: { poDate: "desc" },
    }),
    prisma.purchaseOrder.count({ where: { ...scope, isDraft: true } }),
  ]);

  const rows = pos.map((p) => {
    const totalQty = p.items.reduce((s, i) => s + i.qty, 0);
    const receivedQty = p.items.reduce((s, i) => s + i.receivedQty, 0);
    const pending = Math.max(0, totalQty - receivedQty);
    return {
      id: p.id,
      poNumber: p.poNumber,
      vendorCode: p.vendor.code,
      vendorName: p.vendor.name,
      poDate: p.poDate,
      dueDate: p.dueDate,
      status: p.status,
      total: p.total,
      pendingQty: pending,
    };
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Purchase Orders</h1>
          <p className="text-sm text-ink-faint">
            {rows.length} {isDraftView ? "draft" : "order"}{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchase-orders" className={`rounded-full px-3 py-1 text-xs font-bold ${!isDraftView ? "bg-brand-black text-white" : "bg-surface-muted text-ink-mid hover:bg-brand-yellow-50"}`}>Posted</Link>
          <Link href="/purchase-orders?view=drafts" className={`rounded-full px-3 py-1 text-xs font-bold ${isDraftView ? "bg-brand-black text-white" : draftCount > 0 ? "bg-brand-yellow-pale text-brand-yellow-dark hover:bg-brand-yellow-light" : "bg-surface-muted text-ink-faint hover:bg-brand-yellow-50"}`}>
            Drafts {draftCount > 0 ? `(${draftCount})` : "∅"}
          </Link>
          <NewButton href="/purchase-orders/new" label="+ New PO" />
        </div>
      </div>
      <POTable rows={rows} initialQuery={q ?? ""} initialStatus={status ?? ""} />
    </div>
  );
}
