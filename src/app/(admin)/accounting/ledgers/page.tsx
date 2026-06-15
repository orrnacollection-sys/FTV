import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { AccountList } from "../AccountList";

export const dynamic = "force-dynamic";

export default async function LedgersPage() {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId },
    orderBy: { code: "asc" },
    include: {
      customer: { select: { code: true, name: true } },
      vendor: { select: { code: true, name: true } },
    },
  });

  const parentIds = new Set(accounts.map((a) => a.parentId).filter(Boolean) as string[]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const labelOf = (id: string | null) => {
    if (!id) return null;
    const p = byId.get(id);
    return p ? `${p.code ? p.code + " · " : ""}${p.name}` : null;
  };

  const rows = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    subType: a.subType,
    parentId: a.parentId,
    parentLabel: labelOf(a.parentId),
    hasChildren: parentIds.has(a.id),
    isSystem: a.isSystem,
    openingBalance: a.openingBalance,
    isActive: a.isActive,
    linkLabel: a.customer
      ? `${a.customer.code ? a.customer.code + " · " : ""}${a.customer.name}`
      : a.vendor
      ? `${a.vendor.code ? a.vendor.code + " · " : ""}${a.vendor.name}`
      : null,
    linkKind: (a.customer ? "Customer" : a.vendor ? "Vendor" : null) as "Customer" | "Vendor" | null,
  }));

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link href="/accounting/journal" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to Journal
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">Ledgers</h1>
        <p className="text-sm text-ink-faint">
          {accounts.length} ledgers. Press <b>Enter</b> on a ledger to see its transactions.
        </p>
      </div>
      <AccountList accounts={rows} basePath="/accounting/ledgers" showEdit={false} />
    </div>
  );
}
