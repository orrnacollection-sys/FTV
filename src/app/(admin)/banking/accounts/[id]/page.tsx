import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { BankAccountForm } from "../BankAccountForm";
import { toDisplayDate } from "@/lib/date";
import { getActiveCompanyId } from "@/lib/company";

export const dynamic = "force-dynamic";

export default async function EditBankAccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const bank = await prisma.bankAccount.findFirst({
    where: { id, companyId },
    include: { ledger: { select: { code: true } } },
  });
  if (!bank) notFound();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Edit Bank Account</h1>
        <p className="text-sm text-ink-faint">
          CoA sub-ledger: <span className="font-mono">{bank.ledger?.code ?? "—"}</span>
        </p>
      </div>
      <BankAccountForm
        mode="edit"
        bankId={bank.id}
        initial={{
          name: bank.name,
          bankName: bank.bankName,
          accountNo: bank.accountNo,
          ifsc: bank.ifsc ?? "",
          branch: bank.branch ?? "",
          type: bank.type,
          currency: bank.currency,
          openingBalance: bank.openingBalance,
          openingAsOf: bank.openingAsOf ? toDisplayDate(bank.openingAsOf) : "",
          notes: bank.notes ?? "",
          isActive: bank.isActive,
        }}
      />
    </div>
  );
}
