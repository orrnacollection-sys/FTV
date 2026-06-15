import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { NewButton } from "@/components/NewButton";
import { AccountList } from "../AccountList";

export const dynamic = "force-dynamic";

export default async function ChartOfAccountsPage() {
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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Chart of Accounts</h1>
          <p className="text-sm text-ink-faint">
            {accounts.length} ledger accounts · Tally-style 4-digit codes. Parent groups are <b>bold</b>.
            Customer / Vendor sub-ledgers (1130-001…, 2110-001…) auto-create when those masters are added.
            Press <b>Enter</b> on a row to edit it.
          </p>
        </div>
        <NewButton href="/accounting/chart/new" label="+ New Ledger" />
      </div>

      <AccountList accounts={rows} basePath="/accounting/chart" showEdit />
    </div>
  );
}
