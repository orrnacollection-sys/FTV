import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveCompany, getActiveCompanyId } from "@/lib/company";
import { POView } from "./POView";

export const dynamic = "force-dynamic";

export default async function POViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Scope to the active company so a URL-manipulated id from another
  // company's books can't open under this session.
  const companyId = await getActiveCompanyId();
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId },
    include: {
      vendor: true,
      items: { include: { item: { include: { vendor: { select: { model: true } }, priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } } } } } },
    },
  });
  if (!po) notFound();
  const company = await getActiveCompany();

  const totals = po.items.reduce(
    (acc, i) => {
      const net = i.qty * i.rate;
      const tax = (net * i.taxRate) / 100;
      acc.subtotal += net;
      acc.tax += tax;
      acc.qty += i.qty;
      acc.received += i.receivedQty;
      return acc;
    },
    { subtotal: 0, tax: 0, qty: 0, received: 0 },
  );

  return (
    <POView
      po={{
        id: po.id,
        poNumber: po.poNumber,
        poDate: po.poDate,
        dueDate: po.dueDate,
        status: po.status,
        notes: po.notes,
        total: po.total,
        isDraft: po.isDraft,
      }}
      org={{
        name: company.brandName,
        addressLine: company.addressLine,
        gst: company.defaultGstin?.gstin ?? null,
      }}
      vendor={{
        code: po.vendor.code ?? "",
        name: po.vendor.name,
        email: po.vendor.email,
        whatsapp: po.vendor.whatsapp,
        gst: po.vendor.gst,
        address: po.vendor.address,
        city: po.vendor.city,
        state: po.vendor.state,
        pincode: po.vendor.pincode,
      }}
      items={po.items.map((i) => ({
        id: i.id,
        skuCode: i.item.skuCode,
        name: i.item.name,
        hsn: i.item.hsn,
        model: i.item.priceRevisions[0]?.model ?? i.item.vendor.model ?? "",
        imageUrl: i.item.imageUrl,
        qty: i.qty,
        rate: i.rate,
        taxRate: i.taxRate,
        total: i.total,
        receivedQty: i.receivedQty,
      }))}
      totals={totals}
    />
  );
}
