import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { loadModelBasis } from "@/lib/vendor-ledger";
import { companyWhere } from "@/lib/scope";
import { PaymentsTable } from "./PaymentsTable";

export const dynamic = "force-dynamic";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; model?: string; vendorId?: string; q?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();
  const basisOf = await loadModelBasis();

  // Aggregate FTV/consignment payable from Sales by vendor + month + model.
  // OR is settled separately on the OR Payment screen (GRN-based), so it's excluded here.
  const sales = await prisma.sale.findMany({
    where: {
      ...scope,
      ...(sp.vendorId ? { vendorId: sp.vendorId } : {}),
    },
    select: {
      vendorId: true,
      vchDate: true,
      qtySold: true,
      qtyReturn: true,
      qtyRTO: true,
      unitRate: true,
      taxRate: true,
      model: true,
      item: { select: { vendor: { select: { code: true, name: true, ifsc: true, accountNo: true, bankName: true } } } },
    },
  });

  type Agg = {
    vendorId: string;
    month: string;
    model: string;
    vendorCode: string;
    vendorName: string;
    payable: number;
    adj: number; // net Dr/Cr notes (credit + / debit −)
    ifsc: string | null;
    accountNo: string | null;
    bankName: string | null;
  };

  const aggMap = new Map<string, Agg>();
  for (const s of sales) {
    const itemModel = s.model ?? "";
    // Only consignment (ON_SALE) models settle here; OR lives on the OR Payment screen.
    if (!itemModel || basisOf(itemModel).basis !== "ON_SALE") continue;
    if (sp.model && itemModel !== sp.model) continue;
    const month = monthKey(s.vchDate);
    if (sp.month && month !== sp.month) continue;
    const key = `${s.vendorId}|${month}|${itemModel}`;
    const netQty = s.qtySold - s.qtyReturn - s.qtyRTO;
    const amount = netQty * s.unitRate;
    const gst = (amount * s.taxRate) / 100;
    const total = amount + gst;

    const cur = aggMap.get(key);
    if (cur) cur.payable += total;
    else {
      aggMap.set(key, {
        vendorId: s.vendorId,
        month,
        model: itemModel,
        vendorCode: s.item.vendor.code ?? "",
        vendorName: s.item.vendor.name,
        payable: total,
        adj: 0,
        ifsc: s.item.vendor.ifsc ?? null,
        accountNo: s.item.vendor.accountNo ?? null,
        bankName: s.item.vendor.bankName ?? null,
      });
    }
  }

  // Fold FTV-tagged Debit/Credit Notes into the month's payable (Credit + / Debit −).
  const notes = await prisma.otherCharge.findMany({
    where: { ...scope, ...(sp.vendorId ? { vendorId: sp.vendorId } : {}) },
    select: { vendorId: true, date: true, direction: true, model: true, total: true, vendor: { select: { code: true, name: true } } },
  });
  for (const n of notes) {
    const m = n.model ?? "";
    if (!m || basisOf(m).basis !== "ON_SALE") continue;
    if (sp.model && m !== sp.model) continue;
    const month = monthKey(n.date);
    if (sp.month && month !== sp.month) continue;
    const key = `${n.vendorId}|${month}|${m}`;
    const net = n.direction === "CREDIT" ? n.total : -n.total;
    const cur = aggMap.get(key);
    if (cur) cur.adj += net;
    else aggMap.set(key, {
      vendorId: n.vendorId, month, model: m, vendorCode: n.vendor.code ?? "", vendorName: n.vendor.name,
      payable: 0, adj: net, ifsc: null, accountNo: null, bankName: null,
    });
  }

  // Pull existing Payment rows.
  const payments = await prisma.payment.findMany({
    where: {
      ...scope,
      ...(sp.model ? { model: sp.model } : {}),
      ...(sp.month ? { month: sp.month } : {}),
      ...(sp.vendorId ? { vendorId: sp.vendorId } : {}),
    },
  });
  const paymentByKey = new Map(payments.map((p) => [`${p.vendorId}|${p.month}|${p.model}`, p]));

  let rows = [...aggMap.values()].map((a) => {
    const p = paymentByKey.get(`${a.vendorId}|${a.month}|${a.model}`);
    const paid = p?.amountPaid ?? 0;
    return {
      ...a,
      paid,
      balance: a.payable + a.adj - paid,
      status: p?.status ?? "PENDING",
      utr: p?.utr ?? null,
      remarks: p?.remarks ?? null,
      paidOn: p?.paidOn ?? null,
    };
  });
  if (sp.q) {
    const q = sp.q.toLowerCase();
    rows = rows.filter((r) => r.vendorName.toLowerCase().includes(q) || r.vendorCode.toLowerCase().includes(q));
  }
  rows.sort((a, b) => b.month.localeCompare(a.month) || a.vendorName.localeCompare(b.vendorName));

  // Month options: distinct months actually present in sales.
  const months = [...new Set(sales.map((s) => monthKey(s.vchDate)))].sort().reverse();
  const [vendors, onSaleModels] = await Promise.all([
    prisma.vendor.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.modelMaster.findMany({ where: { paymentBasis: "ON_SALE", isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, label: true, paymentBasis: true } }),
  ]);
  // Which ON_SALE models actually have payable rows? Used by the always-visible
  // model buttons to mark "no activity" with ∅.
  const modelsWithData = [...new Set(rows.map((r) => r.model))];

  const totalSoldUncovered = rows.reduce((s, r) => s + (r.payable + r.adj - r.paid), 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">FTV Payment</h1>
        <p className="text-sm text-ink-faint">
          {rows.length} payable line{rows.length === 1 ? "" : "s"} · consignment (pay-on-sale) models, by vendor + month + model. OR is on the OR Payment screen.
        </p>
      </div>
      <PaymentsTable
        rows={rows}
        months={months}
        models={onSaleModels.map((m) => ({ code: m.code, label: m.label, basis: m.paymentBasis }))}
        modelsWithData={modelsWithData}
        vendors={vendors}
        totals={{ soldUncovered: totalSoldUncovered }}
        initial={{ month: sp.month ?? "", model: sp.model ?? "", vendorId: sp.vendorId ?? "", q: sp.q ?? "" }}
      />
    </div>
  );
}
