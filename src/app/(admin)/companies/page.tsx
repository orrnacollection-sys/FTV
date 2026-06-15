import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus, Trash2, Check } from "lucide-react";
import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveCompanyId, MULTI_COMPANY_ENABLED } from "@/lib/company";
import { deleteCompany, switchActiveCompany } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  await requireAdmin();
  // Multi-company deferred: single-company users manage their one company
  // (profile + GSTINs) under Settings, not a multi-company list.
  if (!MULTI_COMPANY_ENABLED) redirect("/settings/company-profile");
  const activeId = await getActiveCompanyId();
  const companies = await prisma.company.findMany({
    orderBy: [{ isPrimary: "desc" }, { brandName: "asc" }],
    include: {
      _count: {
        select: {
          vendors: true, items: true, customers: true,
          purchaseOrders: true, grns: true, sales: true,
          bankAccounts: true, chartOfAccounts: true,
          gstins: true,
        },
      },
    },
  });

  async function deleteAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (id) await deleteCompany(id);
  }

  async function switchAction(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (id) await switchActiveCompany(id);
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-7 w-7 text-brand-yellow" /> Companies
          </h1>
          <p className="text-sm text-ink-faint">
            Tally-style multi-company. Each company has its own books, vendors, customers, ledgers
            and series. Click <strong>Switch</strong> to load a company — all subsequent pages then show that company&apos;s data.
          </p>
        </div>
        <Link href="/companies/new" className="btn-primary flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Create New Company
        </Link>
      </div>

      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Company</th>
              <th className="th text-center">GSTINs</th>
              <th className="th text-center">Vendors</th>
              <th className="th text-center">Customers</th>
              <th className="th text-center">Items</th>
              <th className="th text-center">POs</th>
              <th className="th text-center">GRNs</th>
              <th className="th text-center">Sales</th>
              <th className="th text-center">Banks</th>
              <th className="th text-center">CoA</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const isActive = c.id === activeId;
              return (
                <tr key={c.id} className={isActive ? "bg-brand-yellow-50/60" : "hover:bg-brand-yellow-50/40"}>
                  <td className="td">
                    <div className="font-semibold flex items-center gap-2">
                      {c.brandName}
                      {isActive && <span className="inline-block rounded-full bg-brand-yellow text-ink-strong px-2 py-0.5 text-[10px] font-bold uppercase">Active</span>}
                      {c.isPrimary && <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold uppercase">Primary</span>}
                      {!c.isActive && <span className="inline-block rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[10px] font-bold uppercase">Inactive</span>}
                    </div>
                    <div className="text-xs text-ink-mid">{c.legalName}</div>
                  </td>
                  <td className="td text-center">{c._count.gstins}</td>
                  <td className="td text-center">{c._count.vendors}</td>
                  <td className="td text-center">{c._count.customers}</td>
                  <td className="td text-center">{c._count.items}</td>
                  <td className="td text-center">{c._count.purchaseOrders}</td>
                  <td className="td text-center">{c._count.grns}</td>
                  <td className="td text-center">{c._count.sales}</td>
                  <td className="td text-center">{c._count.bankAccounts}</td>
                  <td className="td text-center">{c._count.chartOfAccounts}</td>
                  <td className="td text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!isActive && (
                        <form action={switchAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="btn-ghost text-xs py-0.5 px-2 flex items-center gap-1" title="Switch to this company">
                            <Check className="h-3 w-3" /> Switch
                          </button>
                        </form>
                      )}
                      {!c.isPrimary && c._count.vendors + c._count.items + c._count.customers === 0 && (
                        <form action={deleteAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="rounded p-1 hover:bg-rose-50" title="Delete (empty companies only)">
                            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
