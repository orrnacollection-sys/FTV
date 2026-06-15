import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { addDays } from "@/lib/date";
import { loadModelBasis } from "@/lib/vendor-ledger";
import { companyWhere } from "@/lib/scope";
import { OrPaymentView } from "./OrPaymentView";

export const dynamic = "force-dynamic";

export type OrRow = {
  kind: "purchase" | "rtv" | "payment" | "note";
  id: string;
  /** GRN id for drill-down (purchase/rtv rows only). */
  grnId: string | null;
  date: Date;
  invoiceDate: Date | null;
  grnDate: Date | null;
  docNo: string;
  particulars: string;
  dueDate: Date | null;
  debit: number;
  credit: number;
  balance: number;
};

export default async function OrPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const vendors = await prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } });

  let selectedVendor: { code: string | null; name: string } | null = null;
  let rows: OrRow[] = [];
  let summary = { balance: 0, overdue: 0, billed: 0, paid: 0 };

  if (sp.vendorId) {
    const v = vendors.find((x) => x.id === sp.vendorId);
    if (v) selectedVendor = { code: v.code, name: v.name };

    const basisOf = await loadModelBasis();
    const [grns, orPayments, notes] = await Promise.all([
      prisma.gRN.findMany({
        where: { ...scope, vendorId: sp.vendorId, isDraft: false },
        select: {
          id: true, grnNo: true, grnDate: true, type: true, vendorInvoiceNo: true, vendorInvoiceDate: true,
          items: { select: { model: true, totalValue: true } },
        },
      }),
      prisma.orPayment.findMany({ where: { ...scope, vendorId: sp.vendorId }, select: { id: true, voucherNo: true, date: true, amount: true, reference: true, particulars: true } }),
      prisma.otherCharge.findMany({ where: { ...scope, vendorId: sp.vendorId }, select: { id: true, chargeNo: true, date: true, direction: true, model: true, reason: true, total: true } }),
    ]);

    const entries: Omit<OrRow, "balance">[] = [];

    for (const g of grns) {
      // OR portion of this GRN + the term of the OR model on it.
      let orTotal = 0;
      let term = 45;
      for (const it of g.items) {
        const cfg = basisOf(it.model);
        if (cfg.basis === "ON_GRN") { orTotal += it.totalValue; term = cfg.term; }
      }
      if (orTotal <= 0) continue;
      if (g.type === "RTV") {
        entries.push({
          kind: "rtv", id: g.grnNo, grnId: g.id, date: g.grnDate, invoiceDate: g.vendorInvoiceDate, grnDate: g.grnDate,
          docNo: g.grnNo, particulars: g.vendorInvoiceNo ? `DN ${g.vendorInvoiceNo}` : "Goods returned",
          dueDate: null, debit: orTotal, credit: 0,
        });
      } else {
        // PURCHASE or RFV (Reject-In) → credit, due in term days.
        entries.push({
          kind: "purchase", id: g.grnNo, grnId: g.id, date: g.grnDate, invoiceDate: g.vendorInvoiceDate, grnDate: g.grnDate,
          docNo: g.grnNo,
          particulars: g.type === "RFV"
            ? (g.vendorInvoiceNo ? `CN ${g.vendorInvoiceNo} (Reject-In)` : "Goods re-received (Reject-In)")
            : (g.vendorInvoiceNo ? `Inv ${g.vendorInvoiceNo}` : "Goods received"),
          dueDate: addDays(g.grnDate, term), debit: 0, credit: orTotal,
        });
      }
    }

    for (const p of orPayments) {
      entries.push({
        kind: "payment", id: p.id, grnId: null, date: p.date, invoiceDate: null, grnDate: null,
        docNo: p.voucherNo ?? p.reference ?? "—", particulars: p.particulars ?? "Payment",
        dueDate: null, debit: p.amount, credit: 0,
      });
    }

    // OR-tagged Debit/Credit Notes (so OR Payment reconciles with the Vendor Ledger).
    for (const n of notes) {
      if (basisOf(n.model).basis !== "ON_GRN") continue;
      const isCredit = n.direction === "CREDIT";
      entries.push({
        kind: "note", id: n.id, grnId: null, date: n.date, invoiceDate: null, grnDate: null,
        docNo: n.chargeNo, particulars: `${isCredit ? "Credit Note" : "Debit Note"} — ${n.reason}`,
        dueDate: null, debit: isCredit ? 0 : n.total, credit: isCredit ? n.total : 0,
      });
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    let bal = 0;
    rows = entries.map((e) => {
      bal += e.credit - e.debit;
      return { ...e, balance: bal };
    });

    const today = new Date();
    const billed = entries.reduce((s, e) => s + e.credit, 0);
    const paid = entries.reduce((s, e) => s + e.debit, 0);
    let pastDue = 0;
    for (const e of entries) if (e.credit > 0 && e.dueDate && e.dueDate < today) pastDue += e.credit;
    summary = { balance: bal, overdue: Math.max(0, pastDue - paid), billed, paid };
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">OR Payment</h1>
        <p className="text-sm text-ink-faint">
          Outright-purchase (OR) vendor account — receipts are due GRN date + term. Record payments freely; the balance runs like a normal ledger.
        </p>
      </div>
      <OrPaymentView
        vendors={vendors}
        selectedVendor={selectedVendor}
        rows={rows}
        summary={summary}
        initialVendorId={sp.vendorId ?? ""}
      />
    </div>
  );
}
