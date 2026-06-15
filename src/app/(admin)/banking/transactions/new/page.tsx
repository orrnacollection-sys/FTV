import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TxnForm } from "../TxnForm";

export const dynamic = "force-dynamic";

export default async function NewBankTransactionPage() {
  await requireAdmin();
  const [banks, customers, vendors, coa] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.vendor.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    // Only non-bank, non-customer/vendor ledger accounts shown in the "Other CoA" picker.
    prisma.chartOfAccount.findMany({
      where: {
        isActive: true,
        customerId: null,
        vendorId: null,
        bankAccountId: null,
        // Skip group headers (no parentId means top-level Assets/Liab/etc.).
        parentId: { not: null },
      },
      orderBy: { code: "asc" },
      select: { code: true, name: true, type: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Record Bank Transaction</h1>
        <p className="text-sm text-ink-faint">
          Picking a Customer (for RECEIPT) or Vendor (for PAYMENT) clears their sub-ledger.
          CHARGE defaults to Bank Charges (5280) · INTEREST to Interest Income (4210).
        </p>
      </div>
      <TxnForm
        banks={banks}
        customers={customers}
        vendors={vendors.map((v) => ({ id: v.id, label: v.code ? `${v.code} · ${v.name}` : v.name }))}
        coa={coa.map((c) => ({ ...c, code: c.code ?? "" }))}
      />
    </div>
  );
}
