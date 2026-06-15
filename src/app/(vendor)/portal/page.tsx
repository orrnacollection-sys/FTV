import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { Package, FileText, Truck, ShoppingCart } from "lucide-react";
import Link from "next/link";

export default async function VendorDashboard() {
  const me = await requireVendor();
  const vendor = await prisma.vendor.findUnique({
    where: { id: me.vendorId },
    select: { code: true, name: true, status: true },
  });

  const itemCount = await prisma.item.count({ where: { vendorId: me.vendorId } });

  const stats = [
    { label: "Active SKUs", value: itemCount, href: "/portal/items", icon: Package },
    { label: "Purchase Orders", value: "—", href: "#", icon: FileText, locked: true },
    { label: "GRNs", value: "—", href: "#", icon: Truck, locked: true },
    { label: "Sales", value: "—", href: "#", icon: ShoppingCart, locked: true },
  ];

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">
          {vendor?.code} · {vendor?.status}
        </div>
        <h1 className="font-display text-3xl font-bold">{vendor?.name}</h1>
        <p className="text-sm text-ink-faint mt-1">Your vendor dashboard.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          const card = (
            <div className={`card p-5 transition ${s.locked ? "opacity-50" : "hover:border-brand-yellow-dark hover:-translate-y-0.5"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">{s.label}</div>
                <Icon className="h-4 w-4 text-ink-faint" />
              </div>
              <div className="mt-2 font-display text-3xl font-bold">{s.value}</div>
              {s.locked && <div className="mt-2 text-[10px] uppercase tracking-wider text-ink-faint">Coming Phase 2</div>}
            </div>
          );
          return s.locked ? <div key={s.label}>{card}</div> : <Link key={s.label} href={s.href}>{card}</Link>;
        })}
      </div>
    </div>
  );
}
