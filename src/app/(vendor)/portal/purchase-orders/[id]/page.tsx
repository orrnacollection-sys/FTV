import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { toDisplayDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { ChevronLeft } from "lucide-react";

export default async function VendorPOViewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireVendor();
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          item: {
            include: {
              vendor: { select: { model: true } },
              priceRevisions: { orderBy: { effectiveDate: "desc" }, take: 1, select: { model: true } },
            },
          },
        },
      },
    },
  });
  if (!po || po.vendorId !== me.vendorId) notFound();

  let subtotal = 0, tax = 0, totalQty = 0, totalReceived = 0;
  for (const i of po.items) {
    const net = i.qty * i.rate;
    subtotal += net;
    tax += (net * i.taxRate) / 100;
    totalQty += i.qty;
    totalReceived += i.receivedQty;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/portal/purchase-orders" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Back to list
        </Link>
        <h1 className="font-display text-3xl font-bold mt-1">{po.poNumber}</h1>
        <p className="text-sm text-ink-faint">
          {toDisplayDate(po.poDate)}{po.dueDate ? ` · Due ${toDisplayDate(po.dueDate)}` : ""}
          {" · "}<span className="badge border-brand-yellow-light bg-brand-yellow-50">{po.status.replace("_", " ")}</span>
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">Items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">SKU</th>
                <th className="th">Item</th>
                <th className="th">Model</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Pending</th>
                <th className="th text-right">Rate</th>
                <th className="th text-right">GST %</th>
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((i) => (
                <tr key={i.id}>
                  <td className="td font-mono text-xs">{i.item.skuCode}</td>
                  <td className="td">{i.item.name}</td>
                  <td className="td">{(() => { const m = i.item.priceRevisions[0]?.model ?? i.item.vendor.model; return m ? (MODEL_LABELS[m as Model] ?? m) : "—"; })()}</td>
                  <td className="td text-right tabular-nums">{i.qty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{i.receivedQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">
                    {i.qty - i.receivedQty > 0 ? <span className="font-bold text-amber-700">{(i.qty - i.receivedQty).toFixed(2)}</span> : "—"}
                  </td>
                  <td className="td text-right tabular-nums">{i.rate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{i.taxRate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-medium">{i.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-border p-4">
          <div className="text-sm space-y-1 text-right">
            <div>Subtotal <span className="ml-6 tabular-nums">{subtotal.toFixed(2)}</span></div>
            <div>GST <span className="ml-6 tabular-nums">{tax.toFixed(2)}</span></div>
            <div className="font-display text-xl font-bold border-t border-border pt-1">Total <span className="ml-6 tabular-nums">{(subtotal + tax).toFixed(2)}</span></div>
            <div className="text-xs text-ink-faint">Qty {totalQty.toFixed(2)} · Received {totalReceived.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {po.notes && (
        <div className="card p-5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mb-2">Notes</div>
          <div className="text-sm">{po.notes}</div>
        </div>
      )}
    </div>
  );
}
