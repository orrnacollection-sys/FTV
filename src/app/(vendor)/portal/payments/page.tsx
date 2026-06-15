import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { loadModelBasis } from "@/lib/vendor-ledger";
import { VendorPaymentsTable } from "./VendorPaymentsTable";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * FTV (pay-on-sale) payment summary for the vendor — by month + model.
 * OR (pay-on-GRN) models are EXCLUDED here; they settle on the OR Payment screen
 * (credited at GRN + term), not via a sale-based monthly payable. Net = sold −
 * return − RTO, matching the admin FTV Payment screen.
 */
export default async function VendorPaymentsPage() {
  const me = await requireVendor();
  const basisOf = await loadModelBasis();

  const [sales, notes, payments] = await Promise.all([
    prisma.sale.findMany({
      where: { vendorId: me.vendorId },
      select: {
        vchDate: true,
        qtySold: true,
        qtyReturn: true,
        qtyRTO: true,
        unitRate: true,
        taxRate: true,
        model: true,
        item: { select: { vendor: { select: { model: true } } } },
      },
    }),
    prisma.otherCharge.findMany({
      where: { vendorId: me.vendorId },
      select: { date: true, direction: true, model: true, total: true },
    }),
    prisma.payment.findMany({ where: { vendorId: me.vendorId } }),
  ]);

  type Agg = { month: string; model: string; payable: number; adj: number };
  const aggMap = new Map<string, Agg>();
  for (const s of sales) {
    const itemModel = s.model ?? s.item.vendor.model ?? "";
    if (!itemModel || basisOf(itemModel).basis !== "ON_SALE") continue; // OR settles on OR Payment
    const month = monthKey(s.vchDate);
    const key = `${month}|${itemModel}`;
    const netQty = s.qtySold - s.qtyReturn - s.qtyRTO;
    const amount = netQty * s.unitRate;
    const gst = (amount * s.taxRate) / 100;
    const total = amount + gst;
    const cur = aggMap.get(key);
    if (cur) cur.payable += total;
    else aggMap.set(key, { month, model: itemModel, payable: total, adj: 0 });
  }

  // FTV-tagged Dr/Cr notes only (Credit + / Debit −).
  for (const n of notes) {
    const m = n.model ?? "";
    if (!m || basisOf(m).basis !== "ON_SALE") continue;
    const month = monthKey(n.date);
    const key = `${month}|${m}`;
    const net = n.direction === "CREDIT" ? n.total : -n.total;
    const cur = aggMap.get(key);
    if (cur) cur.adj += net;
    else aggMap.set(key, { month, model: m, payable: 0, adj: net });
  }

  const paymentByKey = new Map(payments.map((p) => [`${p.month}|${p.model}`, p]));

  const rows = [...aggMap.values()].map((a) => {
    const p = paymentByKey.get(`${a.month}|${a.model}`);
    const paid = p?.amountPaid ?? 0;
    return {
      month: a.month,
      model: a.model,
      payable: a.payable,
      adj: a.adj,
      paid,
      balance: a.payable + a.adj - paid,
      status: p?.status ?? "PENDING",
      utr: p?.utr ?? null,
      paidOn: p?.paidOn ?? null,
      remarks: p?.remarks ?? null,
    };
  });
  rows.sort((a, b) => b.month.localeCompare(a.month) || a.model.localeCompare(b.model));

  const totals = rows.reduce(
    (acc, r) => { acc.payable += r.payable; acc.adj += r.adj; acc.paid += r.paid; acc.balance += r.balance; return acc; },
    { payable: 0, adj: 0, paid: 0, balance: 0 },
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">FTV Payment</h1>
        <p className="text-sm text-ink-faint">
          Pay-on-sale (FTV) payable by month and model · read-only · OR purchases settle on the <b>OR Payment</b> screen
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Payable</div>
          <div className="font-display text-2xl font-bold tabular-nums">{totals.payable.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Adjustments</div>
          <div className="font-display text-2xl font-bold tabular-nums">{totals.adj > 0 ? "+" : ""}{totals.adj.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Received</div>
          <div className="font-display text-2xl font-bold tabular-nums">{totals.paid.toFixed(2)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Outstanding</div>
          <div className={`font-display text-2xl font-bold tabular-nums ${totals.balance > 0.01 ? "text-amber-700" : "text-green-700"}`}>{totals.balance.toFixed(2)}</div>
        </div>
      </div>

      <VendorPaymentsTable rows={rows} />
    </div>
  );
}
