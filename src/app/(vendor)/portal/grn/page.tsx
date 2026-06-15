import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { VendorGRNsTable } from "./VendorGRNsTable";

export default async function VendorGRNsPage() {
  const me = await requireVendor();
  const grns = await prisma.gRN.findMany({
    where: { vendorId: me.vendorId, isDraft: false },
    include: { items: { select: { qty: true, rejectedQty: true } } },
    orderBy: { grnDate: "desc" },
  });

  const rows = grns.map((g) => ({
    id: g.id,
    grnNo: g.grnNo,
    grnDate: g.grnDate,
    type: g.type,
    vendorInvoiceNo: g.vendorInvoiceNo,
    accepted: g.items.reduce((s, i) => s + (i.qty - i.rejectedQty), 0),
    total: g.total,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Goods Receipt Notes</h1>
        <p className="text-sm text-ink-faint">{rows.length} document{rows.length === 1 ? "" : "s"} · read-only</p>
      </div>
      <VendorGRNsTable rows={rows} />
    </div>
  );
}
