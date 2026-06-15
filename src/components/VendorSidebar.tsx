"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Boxes,
  FileText,
  Truck,
  ShoppingCart,
  Wallet,
  CreditCard,
  Banknote,
  BookOpen,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useShortcutCtx } from "@/components/ShortcutContext";
import { useMobileNav } from "@/components/MobileNavContext";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { MnemonicLabel } from "@/components/MnemonicLabel";

type Leaf = { href: string; label: string; icon: LucideIcon; shortcut?: string };
type Entry =
  | ({ kind: "leaf" } & Leaf)
  | { kind: "group"; key: string; label: string; icon: LucideIcon; children: Leaf[] };

const nav: Entry[] = [
  { kind: "leaf", href: "/portal", label: "Dashboard", icon: LayoutDashboard, shortcut: "alt+d" },
  { kind: "leaf", href: "/portal/items", label: "My Items", icon: Package, shortcut: "alt+i" },
  { kind: "leaf", href: "/portal/inventory", label: "Inventory", icon: Boxes, shortcut: "alt+v" },
  { kind: "leaf", href: "/portal/purchase-orders", label: "Purchase Orders", icon: FileText, shortcut: "alt+p" },
  { kind: "leaf", href: "/portal/grn", label: "GRNs", icon: Truck, shortcut: "alt+r" },
  { kind: "leaf", href: "/portal/sales", label: "Sales", icon: ShoppingCart, shortcut: "alt+s" },
  {
    kind: "group", key: "payment", label: "Payment", icon: Wallet, children: [
      { href: "/portal/payments", label: "FTV Payment", icon: CreditCard, shortcut: "alt+y" },
      { href: "/portal/or-payments", label: "OR Payment", icon: Banknote },
      { href: "/portal/ledger", label: "Vendor Ledger", icon: BookOpen, shortcut: "alt+l" },
    ],
  },
];

const STORAGE_KEY = "ftv.vendorSidebar.collapsed";

export function VendorSidebar({ role }: { role: string }) {
  const path = usePathname();
  const router = useRouter();
  const { register } = useShortcutCtx();
  const { mobileOpen, setMobileOpen } = useMobileNav();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  void role; // reserved for future per-role items

  useEffect(() => { setCollapsed(localStorage.getItem(STORAGE_KEY) === "1"); }, []);

  // Drawer closes on every route change so taps land + close together.
  useEffect(() => { setMobileOpen(false); }, [path, setMobileOpen]);

  const isLeafActive = (href: string) => path === href || (href !== "/portal" && path.startsWith(href));
  const isGroupActive = (children: Leaf[]) => children.some((c) => isLeafActive(c.href));

  // Auto-open whichever group owns the current route.
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const e of nav) if (e.kind === "group" && isGroupActive(e.children)) next.add(e.key);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Register every nav-leaf shortcut (including children).
  useEffect(() => {
    const leaves: Leaf[] = nav.flatMap((e) =>
      e.kind === "leaf" ? (e.shortcut ? [e] : []) : e.children.filter((c) => c.shortcut),
    );
    const unsubs = leaves.map((l) =>
      register({ chord: l.shortcut!, label: `Go to ${l.label}`, group: "Navigation", handler: () => router.push(l.href) }),
    );
    return () => unsubs.forEach((u) => u());
  }, [register, router]);

  // Esc closes the drawer first while it's open.
  useShortcut("escape", () => { if (mobileOpen) setMobileOpen(false); }, { enabled: mobileOpen, label: "Close menu", group: "Navigation" });

  const toggleCollapse = () => setCollapsed((c) => { const next = !c; localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); return next; });
  const toggleGroup = (key: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const expandAndOpen = (key: string) => { setCollapsed(false); localStorage.setItem(STORAGE_KEY, "0"); setOpenGroups((s) => new Set(s).add(key)); };

  const leafClasses = (active: boolean, indent: boolean) =>
    cn(
      "group flex items-center gap-3 rounded py-2 text-[13px] transition",
      collapsed ? "justify-center px-2" : indent ? "pl-9 pr-3" : "px-3",
      active ? "bg-brand-yellow text-brand-black font-bold" : "text-white/70 hover:bg-white/5 hover:text-white",
    );

  const renderLeaf = (leaf: Leaf, indent: boolean) => {
    const active = isLeafActive(leaf.href);
    const Icon = leaf.icon;
    return (
      <Link key={leaf.href} href={leaf.href} title={collapsed ? leaf.label : undefined} className={leafClasses(active, indent)}>
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <span className="flex-1">
            <MnemonicLabel label={leaf.label} chord={leaf.shortcut} active={active} />
          </span>
        )}
        {!collapsed && leaf.shortcut && <Kbd chord={leaf.shortcut} className="bg-white/10 border-white/15 text-white/60" />}
      </Link>
    );
  };

  return (
    <>
      {mobileOpen && (
        <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="md:hidden fixed inset-0 z-30 bg-black/40 animate-in fade-in" />
      )}
      <aside
        className={cn(
          "shrink-0 flex-col border-r border-border bg-brand-black text-white transition-all duration-200",
          "hidden md:flex",
          collapsed ? "md:w-16" : "md:w-64",
          mobileOpen && "!flex fixed inset-y-0 left-0 z-40 w-64 shadow-2xl",
        )}
      >
        <div className={cn("flex items-center py-6", collapsed ? "justify-center px-2" : "justify-between px-6")}>
          {!collapsed && (
            <div>
              <div className="font-display text-xl font-bold">Vendor Portal</div>
              <div className="text-[9px] uppercase tracking-[.14em] text-white/40 mt-0.5">Adwitiya FTV</div>
            </div>
          )}
          <button type="button" onClick={toggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          {nav.map((e) => {
            if (e.kind === "leaf") return renderLeaf(e, false);
            const groupActive = isGroupActive(e.children);
            const open = openGroups.has(e.key);
            const Icon = e.icon;
            return (
              <div key={e.key} className="mt-0.5">
                <button
                  type="button"
                  onClick={() => (collapsed ? expandAndOpen(e.key) : toggleGroup(e.key))}
                  title={collapsed ? e.label : undefined}
                  aria-expanded={open}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded py-2 text-[13px] transition",
                    collapsed ? "justify-center px-2" : "px-3",
                    groupActive ? "text-white font-semibold" : "text-white/70 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="flex-1 text-left">{e.label}</span>}
                  {!collapsed && (open ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 opacity-60" />)}
                </button>
                {!collapsed && open && (
                  <div className="mt-0.5 space-y-0.5">
                    {e.children.map((c) => renderLeaf(c, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {!collapsed && (
          <div className="border-t border-white/10 px-6 py-3 text-[10px] text-white/40">© Adwitiya Global</div>
        )}
      </aside>
    </>
  );
}
