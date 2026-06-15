import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { VendorPOsTable } from "./VendorPOsTable";

export default async function VendorPOsPage() {
  const me = await requireVendor();
  const pos = await prisma.purchaseOrder.findMany({
    where: { vendorId: me.vendorId, isDraft: false },
    include: { items: { select: { qty: true, receivedQty: true } } },
    orderBy: { poDate: "desc" },
  });

  const rows = pos.map((p) => {
    const totalQty = p.items.reduce((s, i) => s + i.qty, 0);
    const received = p.items.reduce((s, i) => s + i.receivedQty, 0);
    return {
      id: p.id,
      poNumber: p.poNumber,
      poDate: p.poDate,
      dueDate: p.dueDate,
      status: p.status,
      total: p.total,
      pending: Math.max(0, totalQty - received),
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Purchase Orders</h1>
        <p className="text-sm text-ink-faint">{rows.length} order{rows.length === 1 ? "" : "s"} placed with you · read-only</p>
      </div>
      <VendorPOsTable rows={rows} />
    </div>
  );
}
