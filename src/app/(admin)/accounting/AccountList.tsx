"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { Pencil, ChevronRight, Search } from "lucide-react";

export type AccountRow = {
  id: string;
  code: string | null;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
  /** "code · name" of the parent account, or null for a top-level account. */
  parentLabel: string | null;
  hasChildren: boolean;
  isSystem: boolean;
  openingBalance: number;
  isActive: boolean;
  linkLabel: string | null;
  linkKind: "Customer" | "Vendor" | null;
};

const TYPE_TONE: Record<string, string> = {
  ASSET: "bg-blue-100 text-blue-800",
  LIABILITY: "bg-amber-100 text-amber-800",
  INCOME: "bg-emerald-100 text-emerald-800",
  EXPENSE: "bg-red-100 text-red-800",
  EQUITY: "bg-violet-100 text-violet-800",
};

const ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

const GROUPS = [
  { value: "", label: "All groups" },
  { value: "ASSET", label: "Assets" },
  { value: "LIABILITY", label: "Liabilities" },
  { value: "EQUITY", label: "Equity" },
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expenses" },
];

/**
 * Single flat account table shared by Chart of Accounts (edit) and the Ledger
 * explorer (drill-down). Rows are ordered by group (Asset → Liability → …) then
 * code, with the Group and Parent shown as columns. A live-search box (auto-
 * focused) and a Group filter sit on top; one yellow row cursor (↑/↓, Home/End,
 * Enter) drives the table. Enter or a click opens the row at `${basePath}/${id}`.
 * Accounts that have children render bold.
 */
export function AccountList({
  accounts,
  basePath,
  showEdit,
}: {
  accounts: AccountRow[];
  basePath: string;
  showEdit: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");

  // One flat list, grouped by type in report order, code order within, then
  // narrowed by the Group filter before the live text search runs.
  const ordered = ORDER.flatMap((t) => accounts.filter((a) => a.type === t));
  const scoped = group ? ordered.filter((a) => a.type === group) : ordered;

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: scoped,
    search: q,
    matches: (a, n) =>
      (a.code ?? "").toLowerCase().includes(n) ||
      a.name.toLowerCase().includes(n) ||
      (a.parentLabel ?? "").toLowerCase().includes(n) ||
      (a.subType ?? "").toLowerCase().includes(n) ||
      (a.linkLabel ?? "").toLowerCase().includes(n) ||
      a.type.toLowerCase().includes(n),
    onOpen: (a) => router.push(`${basePath}/${a.id}`),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            placeholder="Type to find an account…"
            className={`input pl-9 ${LIST_SEARCH_CLASS}`}
          />
        </div>
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="input max-w-[180px]"
          aria-label="Filter by group"
        >
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <span className="text-[11px] text-ink-faint">
          {filtered.length} shown · <b>↑↓</b> move · <b>Enter</b> open
        </span>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-24">Code</th>
              <th className="th">Name</th>
              <th className="th">Group</th>
              <th className="th">Parent</th>
              <th className="th">Sub-type</th>
              <th className="th text-right">Opening ₹</th>
              <th className="th text-center">Active</th>
              <th className="th text-right">{showEdit ? "Edit" : "Open"}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="td py-8 text-center text-ink-faint">No accounts match.</td>
              </tr>
            ) : (
              filtered.map((a, i) => (
                <tr
                  key={a.id}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => router.push(`${basePath}/${a.id}`)}
                  className={`cursor-pointer ${i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}`}
                >
                  <td className="td font-mono text-xs font-bold">{a.code ?? "—"}</td>
                  <td className="td">
                    <span className={a.hasChildren ? "font-bold" : ""}>{a.name}</span>
                    {a.linkLabel && (
                      <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">
                        {a.linkKind}: {a.linkLabel}
                      </span>
                    )}
                    {a.isSystem && (
                      <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800" title="System-seeded — rename allowed, delete blocked">
                        system
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TYPE_TONE[a.type] ?? "bg-gray-100 text-gray-700"}`}>
                      {a.type}
                    </span>
                  </td>
                  <td className="td text-xs text-ink-mid">{a.parentLabel ?? "—"}</td>
                  <td className="td text-xs text-ink-mid">{a.subType ?? "—"}</td>
                  <td className="td text-right font-mono">{a.openingBalance.toFixed(2)}</td>
                  <td className="td text-center">
                    {a.isActive
                      ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">YES</span>
                      : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="td text-right">
                    <Link
                      href={`${basePath}/${a.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex rounded p-1.5 hover:bg-brand-yellow-pale"
                      title={showEdit ? "Edit ledger" : "Open ledger"}
                    >
                      {showEdit ? <Pencil className="h-4 w-4 text-ink-mid" /> : <ChevronRight className="h-4 w-4 text-ink-mid" />}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
