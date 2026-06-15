import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { toDisplayDate } from "@/lib/date";
import { ChevronLeft } from "lucide-react";

export default async function VendorGRNViewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireVendor();
  const { id } = await params;
  const grn = await prisma.gRN.findUnique({
    where: { id },
    include: {
      items: { include: { item: { select: { skuCode: true, name: true } }, po: { select: { poNumber: true } } } },
    },
  });
  if (!grn || grn.vendorId !== me.vendorId) notFound();

  const totals = grn.items.reduce(
    (acc, i) => {
      acc.qty += i.qty;
      acc.taxable += i.taxableValue;
      acc.tax += i.tax;
      acc.total += i.totalValue;
      return acc;
    },
    { qty: 0, taxable: 0, tax: 0, total: 0 },
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href="/portal/grn" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Back to list
        </Link>
        <h1 className="font-display text-3xl font-bold mt-1">{grn.grnNo}</h1>
        <p className="text-sm text-ink-faint">
          {toDisplayDate(grn.grnDate)} · <span className="badge border-brand-yellow-light bg-brand-yellow-50">{grn.type}</span>
          {grn.vendorInvoiceNo && <> · Inv {grn.vendorInvoiceNo}{grn.vendorInvoiceDate && ` (${toDisplayDate(grn.vendorInvoiceDate)})`}</>}
        </p>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th">PO</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right">Rate</th>
              <th className="th text-right">GST %</th>
              <th className="th text-right">Taxable</th>
              <th className="th text-right">GST</th>
              <th className="th text-right">Total</th>
              <th className="th">Batch</th>
              <th className="th">Batch Exp</th>
            </tr>
          </thead>
          <tbody>
            {grn.items.map((i) => (
              <tr key={i.id}>
                <td className="td font-mono text-xs">{i.item.skuCode}</td>
                <td className="td">{i.item.name}</td>
                <td className="td font-mono text-xs">{i.po?.poNumber ?? "—"}</td>
                <td className="td text-right tabular-nums">{i.qty.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{i.rate.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{i.taxRate.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{i.taxableValue.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{i.tax.toFixed(2)}</td>
                <td className="td text-right tabular-nums font-medium">{i.totalValue.toFixed(2)}</td>
                <td className="td font-mono text-xs">{i.batchNo}</td>
                <td className="td">{toDisplayDate(i.batchExpDate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="td font-bold">Totals</td>
              <td className="td text-right tabular-nums font-bold">{totals.qty.toFixed(2)}</td>
              <td className="td"></td><td className="td"></td>
              <td className="td text-right tabular-nums font-bold">{totals.taxable.toFixed(2)}</td>
              <td className="td text-right tabular-nums font-bold">{totals.tax.toFixed(2)}</td>
              <td className="td text-right tabular-nums font-bold">{totals.total.toFixed(2)}</td>
              <td className="td" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
