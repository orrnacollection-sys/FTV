import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { LedgerForm } from "./LedgerForm";

export const dynamic = "force-dynamic";

export default async function NewLedgerPage() {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ledgerCodeMode: true },
  });
  const mode = company?.ledgerCodeMode ?? "AUTO";

  const accounts = await prisma.chartOfAccount.findMany({
    where: { companyId, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });

  // Peek (without incrementing) at the next auto code, for the preview.
  let nextCodePreview = "LED-0001";
  if (mode === "AUTO") {
    const s = await prisma.series.findUnique({
      where: { companyId_docType: { companyId, docType: "LEDGER" } },
    });
    if (s) nextCodePreview = `${s.prefix}${String(s.nextNumber).padStart(s.padding, "0")}`;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/accounting/chart" className="inline-flex items-center gap-1 text-xs text-ink-mid hover:text-ink">
          <ArrowLeft className="h-3 w-3" /> Back to Chart of Accounts
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold">New Ledger</h1>
        <p className="text-sm text-ink-faint">Create a custom ledger account under any group.</p>
      </div>
      <LedgerForm mode={mode} nextCodePreview={nextCodePreview} parents={accounts} />
    </div>
  );
}
