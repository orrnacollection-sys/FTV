import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { LedgerCodingForm } from "./LedgerCodingForm";

export const dynamic = "force-dynamic";

export default async function AccountingSettingsPage() {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ledgerCodeMode: true },
  });
  const series = await prisma.series.findUnique({
    where: { companyId_docType: { companyId, docType: "LEDGER" } },
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Ledger Coding</h1>
        <p className="text-sm text-ink-faint">
          How new custom ledgers (Chart of Accounts) get their code. Seeded and auto-created
          customer / vendor / bank sub-ledgers always keep their codes regardless.
        </p>
      </div>
      <LedgerCodingForm
        mode={company?.ledgerCodeMode ?? "AUTO"}
        series={{
          prefix: series?.prefix ?? "LED-",
          padding: series?.padding ?? 4,
          nextNumber: series?.nextNumber ?? 1,
        }}
      />
    </div>
  );
}
