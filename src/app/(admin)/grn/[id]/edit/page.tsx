import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { GRNBuilder, type GRNBuilderInitial } from "../../GRNBuilder";
import { GRNHeaderForm } from "./GRNHeaderForm";

export const dynamic = "force-dynamic";

export default async function EditGRNPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const grn = await prisma.gRN.findFirst({
    where: { id, companyId },
    include: {
      vendor: { select: { code: true, name: true } },
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!grn) notFound();

  const warehouses = await prisma.warehouse.findMany({
    where: { companyId },
    orderBy: { code: "asc" }, select: { id: true, code: true, name: true },
  });

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  // POSTED → header-only form. Vendor and line items are read-only metadata.
  if (!grn.isDraft) {
    return (
      <div className="max-w-6xl">
        <h1 className="font-display text-3xl font-bold">
          Edit Header — {grn.grnNo}
        </h1>
        <p className="text-sm text-ink-faint mb-6">
          Fixing typos on a posted {grn.type === "PURCHASE" ? "GRN" : grn.type}. Five fields editable, nothing else moves.
        </p>
        <GRNHeaderForm
          grn={{
            id: grn.id,
            grnNo: grn.grnNo,
            type: grn.type as "PURCHASE" | "RTV" | "RFV",
            vendorName: grn.vendor.name,
            vendorCode: grn.vendor.code ?? "",
            grnDate: iso(grn.grnDate),
            vendorInvoiceNo: grn.vendorInvoiceNo ?? "",
            vendorInvoiceDate: iso(grn.vendorInvoiceDate),
            warehouseId: grn.warehouseId ?? "",
            batchRemarks: grn.batchRemarks ?? "",
          }}
          warehouses={warehouses}
        />
      </div>
    );
  }

  // DRAFT → full builder.
  const [vendors, items] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.item.findMany({ where: { companyId, itemType: { not: "SERVICE" } }, orderBy: { name: "asc" }, include: { priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1 } } }),
  ]);
  const itemRows = items.map((it) => ({
    id: it.id, skuCode: it.skuCode, name: it.name, vendorId: it.vendorId,
    latestRate: it.priceRevisions[0]?.transferPrice ?? 0,
    latestTax: it.priceRevisions[0]?.taxRate ?? 0,
  }));

  const initial: GRNBuilderInitial = {
    id: grn.id, grnNo: grn.grnNo, isDraft: grn.isDraft,
    vendorId: grn.vendorId, warehouseId: grn.warehouseId ?? "",
    grnDate: iso(grn.grnDate), invoiceNo: grn.vendorInvoiceNo ?? "", invoiceDate: iso(grn.vendorInvoiceDate),
    items: grn.items.map((row) => ({
      itemId: row.itemId, poItemId: row.poItemId ?? undefined,
      qty: row.qty, rate: row.rate, taxRate: row.taxRate,
    })),
  };
  const returnTo = grn.type === "RTV" ? "/rtv" : grn.type === "RFV" ? "/rfv" : "/grn";

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-3xl font-bold">
        Edit Draft {grn.type === "PURCHASE" ? "GRN" : grn.type}
      </h1>
      <p className="text-sm text-ink-faint mb-6">
        Drafts are fully editable. Promote to allocate a real {grn.type === "PURCHASE" ? "GRN" : grn.type} number, move stock, and bump the linked PO.
      </p>
      <GRNBuilder
        vendors={vendors} items={itemRows} warehouses={warehouses}
        initialType={grn.type as "PURCHASE" | "RTV" | "RFV"}
        returnTo={returnTo} initial={initial}
      />
    </div>
  );
}
