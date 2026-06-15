"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toDisplayDate } from "@/lib/date";
import { toCsv, downloadCsv } from "@/lib/csv";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { BookOpen, Download, ExternalLink, LayoutGrid, Search } from "lucide-react";

type Row = {
  date: Date | string;
  model: string | null;
  type: string;
  docNo: string;
  label: string;
  debit: number;
  credit: number;
  dueDate: Date | string | null;
  balance: number;
  refId: string | null;
};

const TYPE_STYLES: Record<string, string> = {
  Purchase: "border-green-300 bg-green-50 text-green-800",
  "Reject-In": "border-sky-300 bg-sky-50 text-sky-800",
  "Return to Vendor": "border-red-300 bg-red-50 text-red-700",
  Sales: "border-violet-300 bg-violet-50 text-violet-800",
  Payment: "border-sky-300 bg-sky-50 text-sky-800",
  "Debit Note": "border-amber-300 bg-amber-50 text-amber-800",
  "Credit Note": "border-orange-300 bg-orange-50 text-orange-800",
};

function modelLabel(code: string) {
  return code.replace(/_/g, "-");
}

export function LedgerView({
  vendors,
  selectedVendor,
  rows,
  summary,
  modelsPresent,
  allModels,
  tiles,
  initialVendorId,
  initialModel,
}: {
  vendors: { id: string; code: string | null; name: string }[];
  selectedVendor: { code: string | null; name: string } | null;
  rows: Row[];
  summary: { totalDebit: number; totalCredit: number; balance: number };
  modelsPresent: { code: string; basis: string }[];
  allModels: { code: string; label: string; basis: string }[];
  tiles: { ftvPayable: number; orPayable: number; orOverdue: number; monthFtvSales: number };
  initialVendorId: string;
  initialModel: string;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [q, setQ] = useState("");

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: q,
    matches: (r, n) =>
      r.docNo.toLowerCase().includes(n) ||
      r.label.toLowerCase().includes(n) ||
      r.type.toLowerCase().includes(n) ||
      (r.model ?? "").toLowerCase().includes(n),
    onOpen: (r) => { if (r.refId) router.push(`/grn/${r.refId}`); },
  });

  const navigate = (nextVendorId: string, nextModel: string) => {
    const url = new URL(window.location.href);
    if (nextVendorId) url.searchParams.set("vendorId", nextVendorId);
    else url.searchParams.delete("vendorId");
    if (nextModel) url.searchParams.set("model", nextModel);
    else url.searchParams.delete("model");
    router.push(url.pathname + url.search);
  };

  const onSelectVendor = (id: string) => {
    setVendorId(id);
    navigate(id, ""); // reset model when switching vendor
  };

  const today = new Date();
  const isOverdue = (d: Date | string | null) => !!d && new Date(d) < today;

  const onDownload = () => {
    if (!selectedVendor) return;
    const csv = toCsv(
      rows.map((r) => ({
        Date: toDisplayDate(r.date),
        Model: r.model ? modelLabel(r.model) : "—",
        Type: r.type,
        "Doc No": r.docNo,
        Particulars: r.label,
        Due: r.dueDate ? toDisplayDate(r.dueDate) : "",
        Debit: r.debit.toFixed(2),
        Credit: r.credit.toFixed(2),
        Balance: r.balance.toFixed(2),
      })),
    );
    downloadCsv(`ledger-${selectedVendor.code ?? selectedVendor.name}${initialModel ? `-${initialModel}` : ""}.csv`, csv);
  };

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${active ? "bg-brand-black text-white" : "bg-surface-muted text-ink-mid hover:bg-brand-yellow-50"}`;

  return (
    <>
      <div className="mb-4 card p-3 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Vendor</div>
        <select value={vendorId} onChange={(e) => onSelectVendor(e.target.value)} className="input max-w-md">
          <option value="">— pick a vendor —</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <span className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">or quick view</span>
        <Link href="/ledger?view=or-summary" className="rounded-full bg-brand-yellow-pale px-3 py-1 text-xs font-bold text-brand-yellow-dark hover:bg-brand-yellow-light">
          <LayoutGrid className="inline h-3.5 w-3.5 mr-1" />OR all vendors
        </Link>
        <Link href="/ledger?view=ftv-summary" className="rounded-full bg-brand-yellow-pale px-3 py-1 text-xs font-bold text-brand-yellow-dark hover:bg-brand-yellow-light">
          <LayoutGrid className="inline h-3.5 w-3.5 mr-1" />FTV all vendors
        </Link>
        {selectedVendor && rows.length > 0 && (
          <button type="button" onClick={onDownload} className="btn-secondary ml-auto">
            <Download className="h-4 w-4" /> Download CSV
          </button>
        )}
      </div>

      {!selectedVendor ? (
        <div className="card p-10 text-center text-ink-faint">
          <BookOpen className="h-12 w-12 mx-auto opacity-40 mb-3" />
          <div className="text-sm">Select a vendor to view the ledger.</div>
        </div>
      ) : (
        <>
          {/* Dashboard tiles (always whole-vendor) */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">FTV Payable</div>
              <div className="font-display text-2xl font-bold tabular-nums">{tiles.ftvPayable.toFixed(2)}</div>
              <div className="text-[11px] text-ink-faint">accrues on sale</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">OR Payable</div>
              <div className="font-display text-2xl font-bold tabular-nums">{tiles.orPayable.toFixed(2)}</div>
              <div className={`text-[11px] ${tiles.orOverdue > 0.01 ? "text-red-700 font-semibold" : "text-ink-faint"}`}>
                {tiles.orOverdue > 0.01 ? `${tiles.orOverdue.toFixed(2)} overdue` : "none overdue"}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Combined Balance</div>
              <div className={`font-display text-2xl font-bold tabular-nums ${tiles.ftvPayable + tiles.orPayable > 0.01 ? "text-amber-700" : "text-green-700"}`}>
                {(tiles.ftvPayable + tiles.orPayable).toFixed(2)}
              </div>
              <div className="text-[11px] text-ink-faint">owed to vendor</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">FTV Sales (this month)</div>
              <div className="font-display text-2xl font-bold tabular-nums">{tiles.monthFtvSales.toFixed(2)}</div>
              <div className="text-[11px] text-ink-faint">accrued payout</div>
            </div>
          </div>

          {/* Model quick-filter buttons — always show every active model so
              you can confirm "no OR activity" at a glance, not infer it. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mr-1">View</span>
            <button type="button" onClick={() => navigate(vendorId, "")} className={tabClass(!initialModel)}>Combined</button>
            {allModels.map((m) => {
              const hasActivity = modelsPresent.some((p) => p.code === m.code);
              const active = initialModel === m.code;
              const cls = active
                ? "rounded-full bg-brand-black px-3 py-1 text-xs font-bold text-white"
                : hasActivity
                  ? "rounded-full bg-brand-yellow-pale px-3 py-1 text-xs font-bold text-brand-yellow-dark hover:bg-brand-yellow-light"
                  : "rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-faint hover:bg-brand-yellow-50";
              return (
                <button key={m.code} type="button" onClick={() => navigate(vendorId, m.code)} className={cls} title={hasActivity ? `${m.label} (${m.basis === "ON_GRN" ? "GRN + term" : "on sale"})` : `${m.label} — no activity for this vendor`}>
                  {modelLabel(m.code)}
                  <span className="ml-1 opacity-70">{m.basis === "ON_GRN" ? "· GRN+term" : "· on sale"}</span>
                  {!hasActivity && <span className="ml-1 text-ink-faint">·∅</span>}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-ink-faint tabular-nums">
              Balance: <b className={summary.balance > 0.01 ? "text-amber-700" : "text-green-700"}>{summary.balance.toFixed(2)}</b>
            </span>
          </div>

          <div className="mb-3 relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={searchKeyDown}
              placeholder="Type to find a transaction…"
              className={`input pl-9 ${LIST_SEARCH_CLASS}`}
            />
          </div>

          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  {!initialModel && <th className="th">Model</th>}
                  <th className="th">Type</th>
                  <th className="th">Doc No</th>
                  <th className="th">Particulars</th>
                  <th className="th">Due</th>
                  <th className="th text-right">Debit</th>
                  <th className="th text-right">Credit</th>
                  <th className="th text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={initialModel ? 8 : 9} className="td text-center text-ink-faint py-8">No transactions in this view.</td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr
                      key={i}
                      data-list-row={i}
                      onMouseEnter={() => setCursor(i)}
                      className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
                    >
                      <td className="td whitespace-nowrap">{toDisplayDate(r.date)}</td>
                      {!initialModel && <td className="td">{r.model ? modelLabel(r.model) : "—"}</td>}
                      <td className="td">
                        <span className={`badge ${TYPE_STYLES[r.type] ?? ""}`}>{r.type}</span>
                      </td>
                      <td className="td font-mono text-xs">
                        {r.refId ? (
                          <Link href={`/grn/${r.refId}`} className="inline-flex items-center gap-1 text-brand-yellow-dark hover:underline" title="Open this GRN">
                            {r.docNo} <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          r.docNo
                        )}
                      </td>
                      <td className="td">{r.label}</td>
                      <td className={`td whitespace-nowrap text-xs ${r.credit > 0 && isOverdue(r.dueDate) ? "text-red-700 font-semibold" : "text-ink-faint"}`}>
                        {r.dueDate ? toDisplayDate(r.dueDate) : "—"}
                      </td>
                      <td className="td text-right tabular-nums">{r.debit > 0 ? r.debit.toFixed(2) : "—"}</td>
                      <td className="td text-right tabular-nums">{r.credit > 0 ? r.credit.toFixed(2) : "—"}</td>
                      <td className="td text-right tabular-nums font-medium">{r.balance.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
