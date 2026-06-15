import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { toDisplayDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { BackOnEsc } from "@/components/BackOnEsc";

export const dynamic = "force-dynamic";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Transaction-level breakup behind one (month, model) payable row on the vendor
 * Payments page. Lists every Sale line that rolled into that month's figure so
 * the vendor can see exactly how the monthly payment was built up. Same net-of-
 * GST formula as the summary: total = (qtySold − qtyReturn) × rate × (1 + tax%).
 */
export default async function PaymentBreakupPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; model?: string }>;
}) {
  const me = await requireVendor();
  const sp = await searchParams;
  const month = sp.month ?? "";
  const model = sp.model ?? "";

  const sales = await prisma.sale.findMany({
    where: { vendorId: me.vendorId },
    select: {
      vchDate: true,
      marketplace: true,
      transactionType: true,
      qtySold: true,
      qtyReturn: true,
      qtyRTO: true,
      unitRate: true,
      taxRate: true,
      model: true,
      item: { select: { skuCode: true, name: true, vendor: { select: { model: true } } } },
    },
    orderBy: { vchDate: "asc" },
  });

  const notes = await prisma.otherCharge.findMany({
    where: { vendorId: me.vendorId },
    select: { date: true, chargeNo: true, reason: true, direction: true, total: true, model: true },
    orderBy: { date: "asc" },
  });

  const rows = sales
    .filter((s) => monthKey(s.vchDate) === month && (s.model ?? s.item.vendor.model ?? "") === model)
    .map((s) => {
      const netQty = s.qtySold - s.qtyReturn - s.qtyRTO;
      const amount = netQty * s.unitRate;
      const gst = (amount * s.taxRate) / 100;
      return {
        date: s.vchDate,
        marketplace: s.marketplace,
        type: s.transactionType,
        sku: s.item.skuCode,
        name: s.item.name,
        qtySold: s.qtySold,
        qtyReturn: s.qtyReturn,
        rto: s.qtyRTO,
        netQty,
        rate: s.unitRate,
        taxRate: s.taxRate,
        amount,
        gst,
        total: amount + gst,
      };
    });

  const tot = rows.reduce(
    (a, r) => { a.amount += r.amount; a.gst += r.gst; a.total += r.total; return a; },
    { amount: 0, gst: 0, total: 0 },
  );

  const noteRows = notes
    .filter((n) => monthKey(n.date) === month && (n.model ?? "") === model)
    .map((n) => ({ date: n.date, chargeNo: n.chargeNo, reason: n.reason, signed: n.direction === "CREDIT" ? n.total : -n.total }));
  const adj = noteRows.reduce((s, r) => s + r.signed, 0);

  return (
    <div>
      <BackOnEsc />
      <div className="mb-6">
        <Link href="/portal/payments" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to FTV Payment
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">Payment Breakup</h1>
        <p className="text-sm text-ink-faint">
          {month} · {(MODEL_LABELS[model as Model] ?? model) || "—"} · {rows.length} transaction{rows.length === 1 ? "" : "s"} · payable ₹{tot.total.toFixed(2)}
          {Math.abs(adj) > 0.005 ? ` · adj ₹${adj.toFixed(2)}` : ""}
        </p>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th whitespace-nowrap">Date</th>
              <th className="th">Channel</th>
              <th className="th">Type</th>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th text-right">Sold</th>
              <th className="th text-right">Return</th>
              <th className="th text-right">RTO</th>
              <th className="th text-right">Net</th>
              <th className="th text-right">Rate</th>
              <th className="th text-right">Amount</th>
              <th className="th text-right">GST</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={13} className="td py-8 text-center text-ink-faint">No transactions for this month / model.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="hover:bg-brand-yellow-50/40">
                  <td className="td whitespace-nowrap">{toDisplayDate(r.date)}</td>
                  <td className="td">{r.marketplace}</td>
                  <td className="td">
                    <span className={`badge ${r.type === "RETURN" ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-800"}`}>{r.type}</span>
                  </td>
                  <td className="td font-mono text-xs text-brand-yellow-dark">{r.sku}</td>
                  <td className="td">{r.name}</td>
                  <td className="td text-right tabular-nums">{r.qtySold.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.qtyReturn.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rto.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-medium">{r.netQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.rate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.amount.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.gst.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-bold">{r.total.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-black font-bold">
                <td className="td" colSpan={10}>Total</td>
                <td className="td text-right tabular-nums">{tot.amount.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{tot.gst.toFixed(2)}</td>
                <td className="td text-right tabular-nums">{tot.total.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {noteRows.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold">Dr / Cr Notes folded into this month (adj)</h2>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th whitespace-nowrap">Date</th>
                  <th className="th">Note #</th>
                  <th className="th">Reason</th>
                  <th className="th text-right">Adj (Cr + / Dr −)</th>
                </tr>
              </thead>
              <tbody>
                {noteRows.map((n, i) => (
                  <tr key={i} className="hover:bg-brand-yellow-50/40">
                    <td className="td whitespace-nowrap">{toDisplayDate(n.date)}</td>
                    <td className="td font-mono text-xs">{n.chargeNo}</td>
                    <td className="td">{n.reason}</td>
                    <td className="td text-right tabular-nums">
                      <span className={n.signed < 0 ? "text-amber-700" : "text-orange-700"}>{n.signed > 0 ? "+" : ""}{n.signed.toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black font-bold">
                  <td className="td" colSpan={3}>Net adjustment</td>
                  <td className="td text-right tabular-nums">{adj > 0 ? "+" : ""}{adj.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
