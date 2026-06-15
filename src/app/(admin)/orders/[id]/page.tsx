import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, ScrollText } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { toDisplayDate } from "@/lib/date";
import { isB2BRegType } from "@/lib/constants";
import { BackOnEsc } from "@/components/BackOnEsc";

export const dynamic = "force-dynamic";

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_TONE: Record<string, string> = {
  SALE: "border-green-300 bg-green-50 text-green-800",
  RETURN: "border-amber-300 bg-amber-50 text-amber-800",
  RTO: "border-red-300 bg-red-50 text-red-800",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();

  const order = await prisma.marketplaceOrder.findFirst({
    where: { id, companyId },
    include: {
      item: { select: { skuCode: true, name: true, hsn: true } },
      customer: { select: { name: true, gst: true, state: true, gstRegType: true } },
      warehouse: { select: { code: true, name: true } },
    },
  });
  if (!order) notFound();

  // The Sale auto-posts a JV keyed by (AUTO_SALE, order.id) — that's the voucher.
  const voucher = await prisma.journalEntry.findFirst({
    where: { source: "AUTO_SALE", sourceRefId: order.id, companyId },
    select: { id: true, voucherNo: true },
  });

  const isB2B = isB2BRegType(order.customer?.gstRegType);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );

  return (
    <div className="max-w-3xl">
      <BackOnEsc />
      <div className="mb-6">
        <Link href="/orders" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to Orders
        </Link>
        <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold">
          {order.invoiceNo ?? "Order"}
          <span className={`badge ${TYPE_TONE[order.type] ?? ""}`}>{order.type}</span>
          <span className="badge border-gray-300 bg-gray-50 text-gray-700">{isB2B ? "B2B" : "B2C"}</span>
        </h1>
        <p className="text-sm text-ink-faint">
          {toDisplayDate(order.invoiceDate ?? order.date)} · {order.channel} · {order.marketplace}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {voucher && (
          <Link href={`/accounting/journal?edit=${voucher.id}`} className="btn-secondary inline-flex items-center gap-1.5">
            <BookOpen className="h-4 w-4" /> Voucher {voucher.voucherNo}
          </Link>
        )}
        <Link href={`/stock-ledger?itemId=${order.itemId}`} className="btn-secondary inline-flex items-center gap-1.5">
          <ScrollText className="h-4 w-4" /> Stock Ledger
        </Link>
      </div>

      <div className="card space-y-5 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Customer">
            {order.customer ? (
              <>
                {order.customer.name}
                {order.customer.gst && <div className="font-mono text-xs text-ink-faint">{order.customer.gst}</div>}
                {order.customer.state && <div className="text-xs text-ink-faint">{order.customer.state}</div>}
              </>
            ) : (
              <span className="text-ink-faint">— (marketplace B2C)</span>
            )}
          </Field>
          <Field label="Item">
            <span className="font-mono text-xs">{order.item.skuCode}</span> · {order.item.name}
            {order.item.hsn && <div className="text-xs text-ink-faint">HSN {order.item.hsn}</div>}
          </Field>
          <Field label="Place of Supply">{order.placeOfSupply ?? "—"}</Field>
          <Field label="Warehouse">{order.warehouse ? `${order.warehouse.code} · ${order.warehouse.name}` : "—"}</Field>
          <Field label="Qty">{order.qty}</Field>
          <Field label="Sale price / unit">₹{inr(order.salePrice)}</Field>
        </div>

        <table className="w-full text-sm">
          <tbody>
            <tr className="border-t border-border"><td className="py-1.5 text-ink-mid">Taxable value</td><td className="py-1.5 text-right font-mono">{inr(order.taxableValue)}</td></tr>
            <tr><td className="py-1.5 text-ink-mid">GST rate</td><td className="py-1.5 text-right font-mono">{order.gstRate}%</td></tr>
            <tr><td className="py-1.5 text-ink-mid">CGST</td><td className="py-1.5 text-right font-mono">{inr(order.cgst)}</td></tr>
            <tr><td className="py-1.5 text-ink-mid">SGST</td><td className="py-1.5 text-right font-mono">{inr(order.sgst)}</td></tr>
            <tr><td className="py-1.5 text-ink-mid">IGST</td><td className="py-1.5 text-right font-mono">{inr(order.igst)}</td></tr>
            <tr className="border-t-2 border-black font-bold"><td className="py-1.5">Total</td><td className="py-1.5 text-right font-mono">{inr(order.total)}</td></tr>
          </tbody>
        </table>

        {order.remarks && (
          <div className="rounded border border-border bg-surface-gray-50 px-3 py-2 text-xs text-ink-mid">
            <span className="font-bold uppercase tracking-wide">Remarks:</span> {order.remarks}
          </div>
        )}
      </div>
    </div>
  );
}
