import { requireAdmin } from "@/lib/rbac";
import { BankAccountForm } from "../BankAccountForm";

export const dynamic = "force-dynamic";

export default async function NewBankAccountPage() {
  await requireAdmin();
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">New Bank Account</h1>
        <p className="text-sm text-ink-faint">
          Creates a CoA sub-ledger under 1120 automatically (1120-001, 1120-002, …).
          Cash drawer? Pick type CASH.
        </p>
      </div>
      <BankAccountForm mode="create" />
    </div>
  );
}
