import { prisma } from "@/lib/db";
import Link from "next/link";
import { getActiveCompanyId } from "@/lib/company";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const companyId = await getActiveCompanyId();
  const [vendorCount, itemCount, categoryCount] = await Promise.all([
    prisma.vendor.count({ where: { companyId } }),
    prisma.item.count({ where: { companyId } }),
    prisma.category.count({ where: { companyId } }),
  ]);

  const stats = [
    { label: "Vendors", value: vendorCount, href: "/vendors" },
    { label: "Items / SKUs", value: itemCount, href: "/items" },
    { label: "Categories", value: categoryCount, href: "/categories" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-sm text-ink-faint">Overview of vendor & inventory data.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-5 transition hover:border-brand-yellow-dark">
            <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">{s.label}</div>
            <div className="mt-2 font-display text-4xl font-bold">{s.value}</div>
          </Link>
        ))}
      </div>

      <div className="mt-8 card p-5">
        <h2 className="font-display text-lg font-bold">Phase 1 ready</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Vendor Master, Item Master, and Category management are live. POs, GRN, Sales, Payments,
          Stock, Transfers, and Ledger will come in Phase 2 & 3.
        </p>
      </div>
    </div>
  );
}
