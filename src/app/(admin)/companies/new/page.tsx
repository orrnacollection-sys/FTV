import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/rbac";
import { MULTI_COMPANY_ENABLED } from "@/lib/company";
import { CompanyForm } from "../CompanyForm";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await requireAdmin();
  // Multi-company deferred: creating additional companies is disabled.
  if (!MULTI_COMPANY_ENABLED) redirect("/settings/company-profile");
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Create New Company</h1>
        <p className="text-sm text-ink-faint">
          The system will:
          <br />· create the company record
          <br />· seed 50 standard Chart of Accounts (with company-scoped codes)
          <br />· create per-company series counters (PO / GRN / INV / JV / BT all reset to 1)
          <br />· grant you owner access
          <br />· switch your active company to the new one
        </p>
      </div>
      <CompanyForm />
    </div>
  );
}
