import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { POBuilder, type POBuilderInitial } from "../../POBuilder";

export const dynamic = "force-dynamic";

export default async function EditPOPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!po) notFound();
  if (po.status === "CANCELLED") redirect(`/purchase-orders/${id}`);

  const [vendors, items] = await Promise.all([
    prisma.vendor.findMany({
      where: { companyId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.item.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } },
    }),
  ]);
  const itemRows = items.map((it) => ({
    id: it.id,
    skuCode: it.skuCode,
    name: it.name,
    hsn: it.hsn,
    vendorId: it.vendorId,
    imageUrl: it.imageUrl,
    latestRate: it.priceRevisions[0]?.transferPrice ?? 0,
    latestTax: it.priceRevisions[0]?.taxRate ?? 0,
  }));

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const initial: POBuilderInitial = {
    id: po.id,
    poNumber: po.poNumber,
    isDraft: po.isDraft,
    status: po.status,
    vendorId: po.vendorId,
    poDate: iso(po.poDate),
    dueDate: iso(po.dueDate),
    notes: po.notes ?? "",
    items: po.items.map((row) => ({
      poItemId: row.id,
      itemId: row.itemId,
      qty: row.qty,
      rate: row.rate,
      taxRate: row.taxRate,
      receivedQty: row.receivedQty,
    })),
  };

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl font-bold">
        Edit {po.isDraft ? "Draft" : "PO"} <span className="font-mono">{po.isDraft ? "" : po.poNumber}</span>
      </h1>
      <p className="text-sm text-ink-faint mb-6">
        {po.isDraft
          ? "Drafts are fully editable. Promote to allocate a real PO number."
          : "Vendor is frozen on posted POs. Received lines have SKU, Rate, and GST locked; their qty can't drop below received."}
      </p>
      <POBuilder vendors={vendors} items={itemRows} initial={initial} />
    </div>
  );
}
