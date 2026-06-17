"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useShortcutCtx } from "@/components/ShortcutContext";
import { useMobileNav } from "@/components/MobileNavContext";
import { useShortcut } from "@/hooks/useShortcut";
import { isTypingTarget } from "@/lib/keyboard";
import { Kbd } from "@/components/Kbd";
import { MnemonicLabel } from "@/components/MnemonicLabel";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Package,
  Tags,
  Warehouse,
  Layers,
  FileText,
  Truck,
  Undo2,
  Redo2,
  ShoppingCart,
  CreditCard,
  Banknote,
  BookOpen,
  Archive,
  ArrowRightLeft,
  SlidersHorizontal,
  LifeBuoy,
  Phone,
  Mail,
  MessageCircle,
  GraduationCap,
  Scale,
  Settings,
  Hash,
  ListOrdered,
  UserCog,
  ScrollText,
  Boxes,
  ShoppingBag,
  Wallet,
  Coins,
  Hourglass,
  Store,
  Megaphone,
  Percent,
  TrendingUp,
  PackageSearch,
  PackagePlus,
  Building2,
  NotebookPen,
  Calculator,
  Landmark,
  Scale as ScaleIcon,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";

type Leaf = { href: string; label: string; icon: LucideIcon; soon?: boolean; shortcut?: string };
type Entry =
  | ({ kind: "leaf" } & Leaf)
  | { kind: "group"; key: string; label: string; icon: LucideIcon; children: Leaf[] };

const nav: Entry[] = [
  { kind: "leaf", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "alt+d" },
  // Multi-company deferred (#106 schema-level isolation later): the company
  // switcher + /companies CRUD are hidden. Edit the single company's profile
  // under Settings → Company Profile. Restore this leaf to revive the UI.
  {
    kind: "group", key: "masters", label: "Masters", icon: Boxes, children: [
      { href: "/vendors", label: "Vendor Master", icon: Users, shortcut: "alt+v" },
      { href: "/customers", label: "Customer Master", icon: UsersRound, shortcut: "alt+u" },
      { href: "/items", label: "Item Master", icon: Package, shortcut: "alt+i" },
      { href: "/categories", label: "Category Master", icon: Tags, shortcut: "alt+a" },
      { href: "/warehouses", label: "Warehouse Master", icon: Warehouse, shortcut: "alt+w" },
      { href: "/models", label: "Model Master", icon: Layers },
      { href: "/tax/hsn-rates", label: "Tax Master (HSN)", icon: Percent, shortcut: "alt+x" },
      { href: "/tax/components", label: "Tax Components", icon: Percent },
    ],
  },
  {
    kind: "group", key: "purchase", label: "Purchase", icon: ShoppingBag, children: [
      { href: "/purchase-orders", label: "Purchase Orders", icon: FileText, shortcut: "alt+p" },
      { href: "/grn", label: "GRN / Purchase", icon: Truck, shortcut: "alt+r" },
      { href: "/rtv", label: "Reject Out / RTV", icon: Undo2 },
      { href: "/rfv", label: "Reject-In / RFV", icon: Redo2 },
    ],
  },
  { kind: "leaf", href: "/sales", label: "Sale & Return", icon: ShoppingCart, shortcut: "alt+s" },
  { kind: "leaf", href: "/other-charges", label: "Journal", icon: NotebookPen, shortcut: "alt+j" },
  {
    kind: "group", key: "marketplace", label: "Marketplace", icon: Store, children: [
      { href: "/orders", label: "Orders", icon: ShoppingCart },
      { href: "/marketing-cost", label: "Marketing Cost", icon: Megaphone },
      { href: "/marketplace-rates", label: "Marketplace Rates", icon: Percent },
      { href: "/margin-report", label: "Margin Report", icon: TrendingUp },
    ],
  },
  {
    kind: "group", key: "payment", label: "Payment", icon: Wallet, children: [
      { href: "/payments", label: "FTV Payment", icon: CreditCard, shortcut: "alt+y" },
      { href: "/or-payments", label: "OR Payment", icon: Banknote },
      { href: "/ledger", label: "Vendor Ledger", icon: BookOpen, shortcut: "alt+l" },
      { href: "/vendor-opening", label: "Vendor Opening", icon: Coins },
    ],
  },
  {
    kind: "group", key: "banking", label: "Banking", icon: Landmark, children: [
      { href: "/banking/accounts", label: "Bank Accounts", icon: Landmark },
      { href: "/banking/transactions", label: "Transactions", icon: ArrowRightLeft, shortcut: "alt+t" },
      { href: "/banking/reconciliation", label: "Reconciliation", icon: Scale },
    ],
  },
  {
    kind: "group", key: "accounting", label: "Accounting", icon: Calculator, children: [
      { href: "/accounting/chart", label: "Chart of Accounts", icon: ListOrdered },
      { href: "/accounting/journal", label: "Journal Entries", icon: NotebookPen },
      { href: "/accounting/ledgers", label: "Ledgers", icon: BookOpen },
      { href: "/accounting/trial-balance", label: "Trial Balance", icon: ScaleIcon },
      { href: "/accounting/pnl", label: "Profit & Loss", icon: TrendingUp },
      { href: "/accounting/balance-sheet", label: "Balance Sheet", icon: Scale },
    ],
  },
  {
    kind: "group", key: "gst", label: "GST Returns", icon: Percent, children: [
      { href: "/gst/gstr-1", label: "GSTR-1 (Outward)", icon: FileText, shortcut: "alt+g" },
      { href: "/gst/gstr-3b", label: "GSTR-3B (Summary)", icon: FileText },
      { href: "/gst/itc-reconciliation", label: "ITC · 2B Reconciliation", icon: Scale },
    ],
  },
  {
    kind: "group", key: "inventory", label: "Inventory", icon: PackageSearch, children: [
      { href: "/opening-stock", label: "Opening Stock", icon: PackagePlus },
      { href: "/stock", label: "Overall Inventory", icon: Archive, shortcut: "alt+o" },
      { href: "/stock-ledger", label: "Stock Ledger", icon: ScrollText },
      { href: "/stale-stock", label: "Stale Stock", icon: Hourglass },
      { href: "/inventory-valuation", label: "Inventory Valuation", icon: Coins },
      { href: "/batch-report", label: "Batch Summary Report", icon: Boxes },
      { href: "/warehouse-stock", label: "Warehouse Stock", icon: Warehouse },
      { href: "/transfers", label: "Warehouse Transfer", icon: ArrowRightLeft },
      { href: "/stock-adjustments", label: "Stock Adjustment", icon: SlidersHorizontal },
    ],
  },
  {
    kind: "group", key: "support", label: "Support Ticket", icon: LifeBuoy, children: [
      { href: "#", label: "Call Back Now", icon: Phone, soon: true },
      { href: "#", label: "Email", icon: Mail, soon: true },
      { href: "#", label: "WhatsApp", icon: MessageCircle, soon: true },
    ],
  },
  { kind: "leaf", href: "#", label: "Training", icon: GraduationCap, soon: true },
  { kind: "leaf", href: "#", label: "Policies", icon: Scale, soon: true },
  {
    kind: "group", key: "settings", label: "Settings", icon: Settings, children: [
      { href: "/settings/company-profile", label: "Company Profile", icon: Building2 },
      { href: "/settings/license", label: "License", icon: Scale },
      { href: "/settings/series", label: "Document Series", icon: ListOrdered },
      { href: "/settings/accounting", label: "Ledger Coding", icon: Calculator },
      { href: "#", label: "Master Code Prefix", icon: Hash, soon: true },
      { href: "#", label: "Email Configuration", icon: Mail, soon: true },
      { href: "#", label: "Document Format", icon: FileText, soon: true },
      { href: "/users", label: "Users & Invites", icon: UserCog },
      { href: "/audit", label: "Audit Log", icon: ScrollText },
    ],
  },
];

const STORAGE_KEY = "ftv.sidebar.collapsed";

/** A navigable row in the keyboard-cursor model (flattened from `nav`). Carries
 *  `label` + `mnemonic` so the focused menu supports first-letter type-ahead. */
type FlatItem =
  | { kind: "leaf"; href: string; label: string; mnemonic: string }
  | { kind: "group"; key: string; label: string; mnemonic: string }
  | { kind: "child"; href: string; label: string; mnemonic: string };

/** The keyboard letter for a menu row: its shortcut's letter when it has one
 *  (e.g. "alt+u" → "u"), otherwise the first letter of the label. Drives both
 *  the underlined hint and the type-ahead jump. */
function mnemonicOf(label: string, shortcut?: string): string {
  const fromChord = shortcut ? shortcut.split("+").pop()?.trim() : undefined;
  return ((fromChord && fromChord.length === 1 ? fromChord : label[0]) ?? "").toLowerCase();
}

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { register } = useShortcutCtx();
  const { mobileOpen, setMobileOpen } = useMobileNav();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // Keyboard cursor index over the flattened menu (-1 = inactive).
  const [cursor, setCursor] = useState(-1);
  // Alt+M focuses the menu off the Dashboard so the user can arrow into a master.
  const [navFocus, setNavFocus] = useState(false);
  // One-shot: after Alt+M opens the Masters group, land the cursor on its first
  // child (resolved in an effect once those children exist in `flat`).
  const focusMastersChild = useRef(false);

  // While the mobile drawer is open, Esc closes it. Registered late so it
  // wins over the EscapeBackNav layout-level handler.
  useShortcut(
    "escape",
    () => { if (mobileOpen) setMobileOpen(false); },
    { enabled: mobileOpen, label: "Close menu", group: "Navigation" },
  );

  // Closing the drawer on every route change (the user just tapped a link).
  useEffect(() => { setMobileOpen(false); }, [path, setMobileOpen]);

  // Register every nav-leaf shortcut once. Nav is a module constant so the
  // dep list is empty — adding a new entry just requires a refresh.
  useEffect(() => {
    const leaves: Leaf[] = nav.flatMap((e) =>
      e.kind === "leaf" ? (e.shortcut ? [e] : []) : e.children.filter((c) => c.shortcut),
    );
    const unsubs = leaves.map((l) =>
      register({
        chord: l.shortcut!,
        label: `Go to ${l.label}`,
        group: "Navigation",
        handler: () => router.push(l.href),
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [register, router]);

  // Alt+M opens & focuses the Masters menu (Tally-style): expand the sidebar,
  // open the Masters group, and drop the keyboard cursor onto it so the user can
  // arrow / Enter — or press a child's own Alt-letter — to pick a master.
  useShortcut(
    "alt+m",
    () => {
      setCollapsed(false);
      localStorage.setItem(STORAGE_KEY, "0");
      setOpenGroups((s) => new Set(s).add("masters"));
      focusMastersChild.current = true;
      setNavFocus(true);
    },
    { label: "Open Masters menu", group: "Navigation" },
  );

  const isLeafActive = (href: string) =>
    href !== "#" && (path === href || (href !== "/dashboard" && path.startsWith(href)));
  const isGroupActive = (children: Leaf[]) => children.some((c) => isLeafActive(c.href));

  // Restore collapse preference after mount (avoids hydration mismatch).
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  // Open whichever group contains the active route (on navigation).
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const e of nav) if (e.kind === "group" && isGroupActive(e.children)) next.add(e.key);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Collapse all groups when EscapeBackNav fires the "back to dashboard" signal.
  useEffect(() => {
    const onCollapse = () => setOpenGroups(new Set());
    window.addEventListener("ftv:sidebar-collapse", onCollapse);
    return () => window.removeEventListener("ftv:sidebar-collapse", onCollapse);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setOpenGroups((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const expandAndOpen = (key: string) => {
    setCollapsed(false);
    localStorage.setItem(STORAGE_KEY, "0");
    setOpenGroups((s) => new Set(s).add(key));
  };

  // ── Keyboard menu cursor ──────────────────────────────────────────────────
  // Active on the Dashboard (no list owns the arrows there). Arrows move a
  // yellow cursor; Enter opens a leaf or toggles a group; Right/Left expand /
  // collapse. Esc/Backspace go back via EscapeBackNav.
  // The keyboard cursor is live on the Dashboard, or anywhere once Alt+M has
  // focused the menu (navFocus). Both need the sidebar expanded and no drawer.
  const menuActive =
    (path === "/dashboard" || navFocus) && !mobileOpen && !collapsed;

  const { flat, indexByKey } = useMemo(() => {
    const flat: FlatItem[] = [];
    const indexByKey = new Map<string, number>();
    const push = (key: string, item: FlatItem) => {
      indexByKey.set(key, flat.length);
      flat.push(item);
    };
    for (const e of nav) {
      if (e.kind === "leaf") {
        push(`leaf:${e.label}`, { kind: "leaf", href: e.href, label: e.label, mnemonic: mnemonicOf(e.label, e.shortcut) });
      } else {
        push(`group:${e.key}`, { kind: "group", key: e.key, label: e.label, mnemonic: mnemonicOf(e.label) });
        if (openGroups.has(e.key)) {
          for (const c of e.children) {
            push(`child:${e.key}:${c.label}`, { kind: "child", href: c.href, label: c.label, mnemonic: mnemonicOf(c.label, c.shortcut) });
          }
        }
      }
    }
    return { flat, indexByKey };
  }, [openGroups]);

  const flatRef = useRef(flat);
  flatRef.current = flat;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const openRef = useRef(openGroups);
  openRef.current = openGroups;

  // In the focused menu, Esc backs out one level (Tally-style): if the cursor is
  // inside an open group, close that dropdown and land on its header; a second
  // Esc (nothing open here) leaves the focused-menu mode. Enabled only during
  // navFocus so it re-registers as the newest Esc handler — winning over
  // EscapeBackNav's layout-level "go back".
  useShortcut(
    "escape",
    () => {
      const f = flatRef.current;
      const cur = cursorRef.current;
      let gi = -1;
      for (let i = Math.min(cur, f.length - 1); i >= 0; i--) {
        if (f[i].kind === "group") { gi = i; break; }
      }
      const g = gi >= 0 ? f[gi] : undefined;
      if (g && g.kind === "group" && openRef.current.has(g.key)) {
        toggleGroup(g.key); // collapse the open dropdown
        setCursor(gi);      // keep focus on the group header
        return;
      }
      setNavFocus(false);
      setCursor(-1);
    },
    { enabled: navFocus, label: "Close menu / exit", group: "Navigation", hidden: true },
  );

  useEffect(() => {
    if (menuActive) setCursor((c) => (c < 0 ? 0 : c));
    else setCursor(-1);
  }, [menuActive]);

  useEffect(() => {
    if (!menuActive || cursor < 0) return;
    document.querySelector(`[data-side-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, menuActive]);

  // After Alt+M opens the Masters group, drop the cursor onto its first child.
  // Depends on navFocus too, so it still fires when the group was already open.
  useEffect(() => {
    if (!navFocus || !focusMastersChild.current) return;
    const gi = indexByKey.get("group:masters");
    if (gi == null) return;
    const first = flat[gi + 1];
    setCursor(first && first.kind === "child" ? gi + 1 : gi);
    focusMastersChild.current = false;
  }, [flat, indexByKey, navFocus]);

  // Navigating away (e.g. after picking a master) ends the focused-menu mode.
  useEffect(() => { setNavFocus(false); }, [path]);

  useEffect(() => {
    if (!menuActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const f = flatRef.current;
      const n = f.length;
      if (!n) return;
      const cur = cursorRef.current;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min((c < 0 ? -1 : c) + 1, n - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max((c < 0 ? 0 : c) - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setCursor(0);
          break;
        case "End":
          e.preventDefault();
          setCursor(n - 1);
          break;
        case "ArrowRight": {
          const it = f[cur];
          if (it && it.kind === "group" && !openRef.current.has(it.key)) { e.preventDefault(); toggleGroup(it.key); }
          break;
        }
        case "ArrowLeft": {
          const it = f[cur];
          if (it && it.kind === "group" && openRef.current.has(it.key)) { e.preventDefault(); toggleGroup(it.key); }
          break;
        }
        case "Enter": {
          const it = f[cur];
          if (!it) return;
          e.preventDefault();
          if (it.kind === "group") toggleGroup(it.key);
          else if (it.href && it.href !== "#") router.push(it.href);
          break;
        }
        default: {
          // Type-ahead: a bare letter/digit jumps to the next visible row whose
          // mnemonic matches, cycling on repeats (Tally / desktop-menu style).
          if (e.altKey || e.ctrlKey || e.metaKey) break;
          if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) break;
          const ch = e.key.toLowerCase();
          const start = cur < 0 ? 0 : cur;
          for (let off = 1; off <= n; off++) {
            const idx = (start + off) % n;
            if (f[idx].mnemonic === ch) { e.preventDefault(); setCursor(idx); break; }
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuActive, router]);

  const leafClasses = (active: boolean, soon: boolean | undefined, indent: boolean, cursorOn: boolean) =>
    cn(
      "group flex items-center gap-3 rounded py-2 text-[13px] transition",
      collapsed ? "justify-center px-2" : indent ? "pl-9 pr-3" : "px-3",
      soon
        ? "text-white/30 cursor-not-allowed"
        : active
        ? "bg-brand-yellow text-brand-black font-bold"
        : "text-white/70 hover:bg-white/5 hover:text-white",
      cursorOn && !active && "bg-brand-yellow/25 ring-2 ring-inset ring-brand-yellow text-white",
    );

  const renderLeaf = (leaf: Leaf, indent: boolean, flatKey: string) => {
    const active = isLeafActive(leaf.href);
    const idx = indexByKey.get(flatKey);
    const cursorOn = menuActive && idx !== undefined && idx === cursor;
    const Icon = leaf.icon;
    const body = (
      <>
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <span className="flex-1">
            <MnemonicLabel
              label={leaf.label}
              chord={leaf.shortcut}
              letter={leaf.shortcut ? undefined : leaf.label[0]}
              active={active}
            />
          </span>
        )}
       {/* {!collapsed && leaf.shortcut && !leaf.soon && (
          <Kbd chord={leaf.shortcut} className="bg-white/10 border-white/15 text-white/60" />
        )}*/}
        {!collapsed && leaf.soon && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/50">soon</span>
        )}
      </>
    );
    if (leaf.soon) {
      return (
        <div key={leaf.label} data-side-idx={idx} aria-disabled title={collapsed ? `${leaf.label} (coming soon)` : undefined} className={leafClasses(false, true, indent, cursorOn)}>
          {body}
        </div>
      );
    }
    return (
      <Link key={leaf.href} href={leaf.href} data-side-idx={idx} title={collapsed ? leaf.label : undefined} className={leafClasses(active, false, indent, cursorOn)}>
        {body}
      </Link>
    );
  };

  return (
    <>
      {/* Backdrop — mobile only, while drawer is open. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/40 animate-in fade-in"
        />
      )}
    <aside
      className={cn(
        "shrink-0 flex-col border-r border-border bg-brand-black text-white transition-all duration-200",
        // Desktop: always visible column with collapse-to-icons width.
        "hidden md:flex",
        collapsed ? "md:w-16" : "md:w-64",
        // Mobile: slide-in fixed drawer when open.
        mobileOpen && "!flex fixed inset-y-0 left-0 z-40 w-64 shadow-2xl",
      )}
    >
      <div className={cn("flex items-center py-6", collapsed ? "justify-center px-2" : "justify-between px-6")}>
        {!collapsed && (
          <div>
            <div className="font-display text-xl font-bold">Adwitiya FTV</div>
            <div className="text-[9px] uppercase tracking-[.14em] text-white/40 mt-0.5">Vendor &amp; Inventory</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {menuActive && (
          <div className="mb-2 rounded bg-brand-yellow/10 px-2 py-1 text-[10px] font-semibold text-brand-yellow">
            type a letter to jump · ↑↓ move · Enter open · →← groups · Esc exit
          </div>
        )}
        {nav.map((e) => {
          if (e.kind === "leaf") return renderLeaf(e, false, `leaf:${e.label}`);

          const groupActive = isGroupActive(e.children);
          const open = openGroups.has(e.key);
          const Icon = e.icon;
          const gIdx = indexByKey.get(`group:${e.key}`);
          const gCursor = menuActive && gIdx !== undefined && gIdx === cursor;

          return (
            <div key={e.key} className="mt-0.5">
              <button
                type="button"
                data-side-idx={gIdx}
                onClick={() => {
                  const willOpen = !openGroups.has(e.key);
                  if (collapsed) expandAndOpen(e.key);
                  else toggleGroup(e.key);
                  // Opening a dropdown focuses the menu so Esc can close it.
                  if (willOpen) {
                    setNavFocus(true);
                    const gi = indexByKey.get(`group:${e.key}`);
                    if (gi != null) setCursor(gi);
                  }
                }}
                title={collapsed ? e.label : undefined}
                aria-expanded={open}
                className={cn(
                  "group flex w-full items-center gap-3 rounded py-2 text-[13px] transition",
                  collapsed ? "justify-center px-2" : "px-3",
                  groupActive ? "text-white font-semibold" : "text-white/70 hover:bg-white/5 hover:text-white",
                  gCursor && "bg-brand-yellow/25 ring-2 ring-inset ring-brand-yellow text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <span className="flex-1 text-left">
                    <MnemonicLabel label={e.label} letter={e.label[0]} active={false} />
                  </span>
                )}
                {!collapsed && (open ? <ChevronDown className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight className="h-3.5 w-3.5 opacity-60" />)}
              </button>
              {!collapsed && open && (
                <div className="mt-0.5 space-y-0.5">
                  {e.children.map((c) => renderLeaf(c, true, `child:${e.key}:${c.label}`))}
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
