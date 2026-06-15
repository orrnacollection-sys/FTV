import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { addDays, toDisplayDate } from "@/lib/date";
import { loadModelBasis } from "@/lib/vendor-ledger";
import { Banknote } from "lucide-react";

export const dynamic = "force-dynamic";

type Kind = "purchase" | "rtv" | "payment" | "note";
type Row = {
  kind: Kind;
  date: Date;
  docNo: string;
  particulars: string;
  dueDate: Date | null;
  debit: number;
  credit: number;
  balance: number;
};

const KIND_STYLES: Record<Kind, string> = {
  purchase: "border-green-300 bg-green-50 text-green-800",
  rtv: "border-red-300 bg-red-50 text-red-700",
  payment: "border-sky-300 bg-sky-50 text-sky-800",
  note: "border-amber-300 bg-amber-50 text-amber-800",
};
const KIND_LABEL: Record<Kind, string> = { purchase: "Purchase", rtv: "Return", payment: "Payment", note: "Note" };

/**
 * Vendor-facing OR (outright-purchase / pay-on-GRN) account — read-only.
 * Credited at each GRN (due GRN date + term), debited by RTV / payments, with a
 * running balance. This is where OR money lives; the FTV Payment screen is for
 * pay-on-sale models only.
 */
export default async function VendorOrPaymentPage() {
  const me = await requireVendor();
  const basisOf = await loadModelBasis();

  const [vendor, grns, orPayments, notes] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: me.vendorId }, select: { code: true, name: true } }),
    prisma.gRN.findMany({
      where: { vendorId: me.vendorId, isDraft: false },
      select: { grnNo: true, grnDate: true, type: true, vendorInvoiceNo: true, items: { select: { model: true, totalValue: true } } },
    }),
    prisma.orPayment.findMany({ where: { vendorId: me.vendorId }, select: { voucherNo: true, date: true, amount: true, reference: true, particulars: true } }),
    prisma.otherCharge.findMany({ where: { vendorId: me.vendorId }, select: { chargeNo: true, date: true, direction: true, model: true, reason: true, total: true } }),
  ]);

  type Entry = Omit<Row, "balance">;
  const entries: Entry[] = [];

  for (const g of grns) {
    let orTotal = 0;
    let term = 45;
    for (const it of g.items) {
      const cfg = basisOf(it.model);
      if (cfg.basis === "ON_GRN") { orTotal += it.totalValue; term = cfg.term; }
    }
    if (orTotal <= 0) continue;
    if (g.type === "RTV") {
      entries.push({ kind: "rtv", date: g.grnDate, docNo: g.grnNo, particulars: g.vendorInvoiceNo ? `DN ${g.vendorInvoiceNo}` : "Goods returned", dueDate: null, debit: orTotal, credit: 0 });
    } else {
      entries.push({
        kind: "purchase", date: g.grnDate, docNo: g.grnNo,
        particulars: g.type === "RFV"
          ? (g.vendorInvoiceNo ? `CN ${g.vendorInvoiceNo} (Reject-In)` : "Goods re-received (Reject-In)")
          : (g.vendorInvoiceNo ? `Inv ${g.vendorInvoiceNo}` : "Goods received"),
        dueDate: addDays(g.grnDate, term), debit: 0, credit: orTotal,
      });
    }
  }

  for (const p of orPayments) {
    entries.push({ kind: "payment", date: p.date, docNo: p.voucherNo ?? p.reference ?? "—", particulars: p.particulars ?? "Payment", dueDate: null, debit: p.amount, credit: 0 });
  }

  for (const n of notes) {
    if (basisOf(n.model).basis !== "ON_GRN") continue;
    const isCredit = n.direction === "CREDIT";
    entries.push({ kind: "note", date: n.date, docNo: n.chargeNo, particulars: `${isCredit ? "Credit Note" : "Debit Note"} — ${n.reason}`, dueDate: null, debit: isCredit ? 0 : n.total, credit: isCredit ? n.total : 0 });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let bal = 0;
  const rows: Row[] = entries.map((e) => { bal += e.credit - e.debit; return { ...e, balance: bal }; });

  const today = new Date();
  const billed = entries.reduce((s, e) => s + e.credit, 0);
  const paid = entries.reduce((s, e) => s + e.debit, 0);
  let pastDue = 0;
  for (const e of entries) if (e.credit > 0 && e.dueDate && e.dueDate < today) pastDue += e.credit;
  const overdue = Math.max(0, pastDue - paid);

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">{vendor?.code}</div>
        <h1 className="font-display text-3xl font-bold">OR Payment</h1>
        <p className="text-sm text-ink-faint">
          Outright-purchase (OR) account — credited at GRN, due GRN date + term · read-only
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Billed (OR credits)" value={billed} />
        <Card label="Paid" value={paid} />
        <Card label="Balance owed to you" value={bal} tone={bal > 0.01 ? "amber" : "green"} />
        <Card label="Overdue" value={overdue} tone={overdue > 0.01 ? "red" : "green"} />
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th whitespace-nowrap">Date</th>
              <th className="th">Type</th>
              <th className="th">Doc No</th>
              <th className="th">Particulars</th>
              <th className="th whitespace-nowrap">Due</th>
              <th className="th text-right">Debit</th>
              <th className="th text-right">Credit</th>
              <th className="th text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Banknote className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No OR transactions.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="hover:bg-brand-yellow-50/40">
                  <td className="td whitespace-nowrap">{toDisplayDate(r.date)}</td>
                  <td className="td"><span className={`badge ${KIND_STYLES[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                  <td className="td font-mono text-xs">{r.docNo}</td>
                  <td className="td">{r.particulars}</td>
                  <td className="td whitespace-nowrap text-xs text-ink-faint">{r.dueDate ? toDisplayDate(r.dueDate) : "—"}</td>
                  <td className="td text-right tabular-nums">{r.debit > 0 ? r.debit.toFixed(2) : "—"}</td>
                  <td className="td text-right tabular-nums">{r.credit > 0 ? r.credit.toFixed(2) : "—"}</td>
                  <td className="td text-right tabular-nums font-medium">{r.balance.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "amber" | "green" | "red" }) {
  const c = tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : tone === "green" ? "text-green-700" : "";
  return (
    <div className="card p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`font-display text-2xl font-bold tabular-nums ${c}`}>{value.toFixed(2)}</div>
    </div>
  );
}
