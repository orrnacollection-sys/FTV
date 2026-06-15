import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRightLeft } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getOutstandingOrders } from "@/lib/allocations";
import { toDisplayDate } from "@/lib/date";
import { getActiveCompanyId } from "@/lib/company";
import { AllocationPanel } from "./AllocationPanel";

export const dynamic = "force-dynamic";

export default async function BankTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();

  const txn = await prisma.bankTransaction.findFirst({
    where: { id, companyId },
    include: {
      bankAccount: { select: { name: true, accountNo: true } },
      contraBank: { select: { name: true } },
      customer: { select: { id: true, name: true } },
      vendor: { select: { name: true, code: true } },
      contraAccount: { select: { code: true, name: true } },
      allocations: {
        include: {
          order: {
            select: {
              id: true,
              invoiceNo: true,
              date: true,
              total: true,
              marketplace: true,
              channel: true,
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { allocatedAt: "asc" },
      },
    },
  });
  if (!txn) notFound();

  const allocated = txn.allocations.reduce((s, a) => s + a.amount, 0);
  const unallocated = Math.max(0, txn.amount - allocated);

  // Only RECEIPT transactions get the allocation panel.
  const showAllocation = txn.type === "RECEIPT";

  // Outstanding orders to choose from — prefer this customer's, fall back to all.
  const candidateOrders = showAllocation
    ? await getOutstandingOrders({ customerId: txn.customerId ?? undefined })
    : [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href="/banking/transactions" className="text-xs text-ink-mid hover:text-ink inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to Transactions
          </Link>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2 mt-2">
            <ArrowRightLeft className="h-7 w-7 text-brand-yellow" /> {txn.txnNo}
          </h1>
          <p className="text-sm text-ink-faint">
            {txn.type} · {toDisplayDate(txn.date)} · {txn.bankAccount.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Amount</div>
          <div className="mt-1 font-mono text-2xl font-bold">₹{txn.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
        </div>
        {showAllocation && (
          <>
            <div className="card p-4">
              <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Allocated</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700">₹{allocated.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">Unallocated</div>
              <div className={`mt-1 font-mono text-2xl font-bold ${unallocated > 0.01 ? "text-amber-700" : "text-emerald-700"}`}>
                ₹{unallocated.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card mb-6">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">Transaction Details</div>
        <dl className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Row label="Date" value={toDisplayDate(txn.date)} />
          <Row label="Reference No" value={txn.refNo ?? "—"} mono />
          <Row label="Bank" value={`${txn.bankAccount.name} · ${txn.bankAccount.accountNo}`} />
          <Row label="Counter Party" value={
            txn.type === "TRANSFER" ? `→ ${txn.contraBank?.name ?? "—"}` :
            txn.customer ? `Customer · ${txn.customer.name}` :
            txn.vendor ? `Vendor · ${txn.vendor.code ? txn.vendor.code + " · " : ""}${txn.vendor.name}` :
            txn.contraAccount ? `${txn.contraAccount.code} · ${txn.contraAccount.name}` : "—"
          } />
          <Row label="Reconciled" value={txn.reconciled ? `Yes (${txn.reconciledAt ? toDisplayDate(txn.reconciledAt) : "—"})` : "No"} />
          <Row label="Narration" value={txn.narration ?? "—"} />
        </dl>
      </div>

      {showAllocation && (
        <AllocationPanel
          txnId={txn.id}
          customerName={txn.customer?.name ?? null}
          unallocated={unallocated}
          existing={txn.allocations.map((a) => ({
            id: a.id,
            amount: a.amount,
            allocatedAt: a.allocatedAt.toISOString(),
            order: {
              id: a.order.id,
              invoiceNo: a.order.invoiceNo,
              date: a.order.date.toISOString(),
              total: a.order.total,
              marketplace: a.order.marketplace,
              channel: a.order.channel,
              customerName: a.order.customer?.name ?? null,
            },
          }))}
          candidates={candidateOrders.map((o) => ({
            id: o.id,
            invoiceNo: o.invoiceNo,
            date: o.date.toISOString(),
            total: o.total,
            outstanding: o.outstanding,
            customerName: o.customerName,
            marketplace: o.marketplace,
            channel: o.channel,
          }))}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}
