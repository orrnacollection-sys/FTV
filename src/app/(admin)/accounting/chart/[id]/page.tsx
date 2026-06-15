import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { EditLedgerForm } from "./EditLedgerForm";

export const dynamic = "force-dynamic";

export default async function EditLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();

  const [account, accounts, company] = await Promise.all([
    prisma.chartOfAccount.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { code: true, name: true } },
        vendor: { select: { code: true, name: true } },
      },
    }),
    prisma.chartOfAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.company.findUnique({ where: { id: companyId }, select: { ledgerCodeMode: true } }),
  ]);
  if (!account) notFound();

  const mode = company?.ledgerCodeMode ?? "AUTO";
  // Stored opening is signed (natural-side positive). Split back into amount + Dr/Cr.
  const naturalDr = account.type === "ASSET" || account.type === "EXPENSE";
  const openingAmount = Math.abs(account.openingBalance);
  const openingType = naturalDr
    ? (account.openingBalance >= 0 ? "DR" : "CR")
    : (account.openingBalance >= 0 ? "CR" : "DR");

  const isLinked = !!(account.customerId || account.vendorId || account.bankAccountId);
  const linkKind = account.customer ? "Customer" : account.vendor ? "Vendor" : account.bankAccountId ? "Bank" : null;
  const linkLabel = account.customer
    ? `${account.customer.code ? account.customer.code + " · " : ""}${account.customer.name}`
    : account.vendor
    ? `${account.vendor.code ? account.vendor.code + " · " : ""}${account.vendor.name}`
    : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/accounting/chart" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to Chart of Accounts
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">Edit Ledger</h1>
        <p className="text-sm text-ink-faint">{account.code ? account.code + " · " : ""}{account.name}</p>
      </div>
      <EditLedgerForm
        mode={mode}
        parents={accounts.filter((a) => a.id !== account.id)}
        account={{
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          subType: account.subType,
          parentId: account.parentId,
          openingAmount,
          openingType,
          isActive: account.isActive,
          isSystem: account.isSystem,
          isLinked,
          linkKind,
          linkLabel,
        }}
      />
    </div>
  );
}
