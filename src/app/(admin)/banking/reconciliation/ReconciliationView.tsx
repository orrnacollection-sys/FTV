"use client";
import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { Upload, Zap, Link2, Link2Off, Ban, AlertTriangle, Search } from "lucide-react";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import {
  importBankStatement,
  autoMatchStatement,
  matchStatementLine,
  unmatchStatementLine,
  ignoreStatementLine,
} from "../actions";

type Bank = { id: string; name: string; bankName: string; accountNo: string };

type StmtLine = {
  id: string;
  statementDate: string;
  description: string;
  refNo: string | null;
  debit: number;
  credit: number;
  balance: number | null;
  matchStatus: string;
  matchedTxn: { id: string; txnNo: string; date: string; amount: number; type: string } | null;
};

type Txn = {
  id: string;
  txnNo: string;
  date: string;
  type: string;
  amount: number;
  narration: string | null;
  refNo: string | null;
  reconciled: boolean;
};

type Summary = {
  statementBalance: number | null;
  bookBalance: number;
  unmatchedLines: number;
  unmatchedTxns: number;
  matchedPairs: number;
  ignoredLines: number;
};

export function ReconciliationView({
  banks,
  initialBankId,
  initialPeriod,
  summary,
  lines,
  txns,
}: {
  banks: Bank[];
  initialBankId: string;
  initialPeriod: string;
  summary: Summary;
  lines: StmtLine[];
  txns: Txn[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [bankId, setBankId] = useState(initialBankId);
  const [period, setPeriod] = useState(initialPeriod);
  const [tab, setTab] = useState<"unmatched" | "matched" | "ignored">("unmatched");
  const [matchTarget, setMatchTarget] = useState<StmtLine | null>(null);

  function navigate(toBankId = bankId, toPeriod = period) {
    const params = new URLSearchParams();
    params.set("bank", toBankId);
    params.set("period", toPeriod);
    router.push(`/banking/reconciliation?${params.toString()}`);
    router.refresh();
  }

  function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const csvText = String(reader.result ?? "");
      startTransition(async () => {
        const r = await importBankStatement({ bankAccountId: bankId, csvText, dedupeKey: `${file.name}|${file.size}` });
        if (!("ok" in r) || !r.ok) {
          toast.error("error" in r ? r.error : "Import failed");
          return;
        }
        toast.success(`Imported ${r.imported} rows · skipped ${r.skipped}`);
        if (r.errors.length > 0) console.warn("Import errors:", r.errors);
        navigate();
      });
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-upload of same name
  }

  function runAutoMatch() {
    startTransition(async () => {
      const r = await autoMatchStatement({ bankAccountId: bankId });
      if (!("ok" in r) || !r.ok) {
        toast.error("error" in r ? r.error : "Auto-match failed");
        return;
      }
      toast.success(`Proposed ${r.proposed}, matched ${r.matched}`);
      navigate();
    });
  }

  const unmatchedLines = useMemo(() => lines.filter((l) => l.matchStatus === "UNMATCHED"), [lines]);
  const matchedLines = useMemo(() => lines.filter((l) => l.matchStatus === "MATCHED"), [lines]);
  const ignoredLines = useMemo(() => lines.filter((l) => l.matchStatus === "IGNORED"), [lines]);
  const unmatchedTxns = useMemo(() => txns.filter((t) => !t.reconciled), [txns]);

  const [lineQ, setLineQ] = useState("");
  const lineNav = useListNav({
    items: unmatchedLines,
    search: lineQ,
    matches: (l, n) =>
      l.description.toLowerCase().includes(n) || (l.refNo ?? "").toLowerCase().includes(n),
    onOpen: (l) => setMatchTarget(l),
  });

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Bank Account</span>
          <select className="input" value={bankId} onChange={(e) => { setBankId(e.target.value); navigate(e.target.value, period); }}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">Period</span>
          <input
            type="month"
            className="input"
            value={period}
            onChange={(e) => { setPeriod(e.target.value); navigate(bankId, e.target.value); }}
          />
        </label>
        <label className="btn-ghost flex items-center gap-1.5 cursor-pointer">
          <Upload className="h-4 w-4" /> Import CSV
          <input type="file" accept=".csv" className="hidden" onChange={onCsv} disabled={busy} />
        </label>
        <button onClick={runAutoMatch} className="btn-primary flex items-center gap-1.5" disabled={busy}>
          <Zap className="h-4 w-4" /> {busy ? "Working…" : "Auto-Match"}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Statement Balance" value={summary.statementBalance != null ? fmtINR(summary.statementBalance) : "—"} />
        <Tile
          label="Book Balance"
          value={fmtINR(summary.bookBalance)}
          tone={summary.statementBalance != null && Math.abs(summary.statementBalance - summary.bookBalance) > 1
            ? "warn"
            : "ok"}
        />
        <Tile label="Unmatched Lines" value={summary.unmatchedLines.toString()} tone={summary.unmatchedLines > 0 ? "warn" : "ok"} />
        <Tile label="Unmatched Txns" value={summary.unmatchedTxns.toString()} tone={summary.unmatchedTxns > 0 ? "warn" : "ok"} />
      </div>

      {summary.statementBalance != null && Math.abs(summary.statementBalance - summary.bookBalance) > 1 && (
        <div className="card border-amber-300 bg-amber-50">
          <div className="px-4 py-2 flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Statement balance differs from book by ₹{fmtINR(Math.abs(summary.statementBalance - summary.bookBalance))} — keep matching.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border flex gap-0">
        <TabBtn active={tab === "unmatched"} onClick={() => setTab("unmatched")}>
          Unmatched ({unmatchedLines.length} · {unmatchedTxns.length})
        </TabBtn>
        <TabBtn active={tab === "matched"} onClick={() => setTab("matched")}>
          Matched ({matchedLines.length})
        </TabBtn>
        <TabBtn active={tab === "ignored"} onClick={() => setTab("ignored")}>
          Ignored ({ignoredLines.length})
        </TabBtn>
      </div>

      {tab === "unmatched" && (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              ref={lineNav.searchRef}
              type="search"
              value={lineQ}
              onChange={(e) => setLineQ(e.target.value)}
              onKeyDown={lineNav.searchKeyDown}
              placeholder="Type to find a statement line…"
              className={`input pl-9 ${LIST_SEARCH_CLASS}`}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <UnmatchedLines
              lines={lineNav.filtered}
              cursor={lineNav.cursor}
              setCursor={lineNav.setCursor}
              onMatch={(l) => setMatchTarget(l)}
              onIgnore={(id) => {
                startTransition(async () => {
                  const r = await ignoreStatementLine(id);
                  if ("error" in r) toast.error(r.error); else toast.success("Ignored");
                  router.refresh();
                });
              }}
            />
            <UnmatchedTxns txns={unmatchedTxns} />
          </div>
        </>
      )}

      {tab === "matched" && <MatchedTable lines={matchedLines} onUnmatch={(id) => {
        startTransition(async () => {
          const r = await unmatchStatementLine(id);
          if ("error" in r) toast.error(r.error); else toast.success("Unmatched");
          router.refresh();
        });
      }} />}

      {tab === "ignored" && <IgnoredTable lines={ignoredLines} />}

      {/* Manual-match modal */}
      {matchTarget && (
        <MatchModal
          line={matchTarget}
          txns={unmatchedTxns}
          onClose={() => setMatchTarget(null)}
          onConfirm={(txnId) => {
            startTransition(async () => {
              const r = await matchStatementLine({ lineId: matchTarget.id, txnId });
              if ("error" in r) toast.error(r.error);
              else {
                toast.success("Matched");
                setMatchTarget(null);
                router.refresh();
              }
            });
          }}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition ${
        active ? "border-brand-yellow text-ink" : "border-transparent text-ink-mid hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className={`card p-3 ${tone === "warn" ? "border-amber-300" : tone === "ok" ? "border-emerald-300" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}

function UnmatchedLines({ lines, cursor, setCursor, onMatch, onIgnore }: { lines: StmtLine[]; cursor: number; setCursor: (i: number) => void; onMatch: (l: StmtLine) => void; onIgnore: (id: string) => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-xs font-bold">
        Statement lines · {lines.length} shown · <span className="font-normal text-ink-mid">Enter = match</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Description · Ref</th>
            <th className="th text-right">Debit</th>
            <th className="th text-right">Credit</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={5} className="td text-center py-6 text-ink-faint">No unmatched lines.</td></tr>
          ) : (
            lines.map((l, i) => (
              <tr
                key={l.id}
                data-list-row={i}
                onMouseEnter={() => setCursor(i)}
                className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
              >
                <td className="td">{fmtDate(l.statementDate)}</td>
                <td className="td">
                  <div>{l.description}</div>
                  {l.refNo && <div className="font-mono text-[10px] text-ink-mid">{l.refNo}</div>}
                </td>
                <td className="td text-right font-mono">{l.debit > 0 ? fmtINR(l.debit) : "—"}</td>
                <td className="td text-right font-mono text-emerald-700 font-bold">{l.credit > 0 ? fmtINR(l.credit) : "—"}</td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onMatch(l)} className="rounded p-1 hover:bg-brand-yellow-pale" title="Match"><Link2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onIgnore(l.id)} className="rounded p-1 hover:bg-gray-100" title="Ignore"><Ban className="h-3.5 w-3.5 text-ink-mid" /></button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedTxns({ txns }: { txns: Txn[] }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-xs font-bold">
        Book transactions · {txns.length} unreconciled
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Txn No · Type</th>
            <th className="th">Ref · Narration</th>
            <th className="th text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {txns.length === 0 ? (
            <tr><td colSpan={4} className="td text-center py-6 text-ink-faint">All caught up.</td></tr>
          ) : (
            txns.map((t) => (
              <tr key={t.id} className="hover:bg-brand-yellow-50/40">
                <td className="td">{fmtDate(t.date)}</td>
                <td className="td">
                  <div className="font-mono">{t.txnNo}</div>
                  <div className="text-[10px] text-ink-mid">{t.type}</div>
                </td>
                <td className="td">
                  {t.refNo && <div className="font-mono text-[10px]">{t.refNo}</div>}
                  {t.narration && <div className="text-ink-mid">{t.narration}</div>}
                </td>
                <td className={`td text-right font-mono font-bold ${["RECEIPT", "INTEREST"].includes(t.type) ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmtINR(t.amount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchedTable({ lines, onUnmatch }: { lines: StmtLine[]; onUnmatch: (id: string) => void }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-xs font-bold">
        Matched pairs · {lines.length}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">Stmt Date</th>
            <th className="th">Description</th>
            <th className="th text-right">Stmt Amount</th>
            <th className="th">↔ Txn No</th>
            <th className="th">Txn Date</th>
            <th className="th text-right">Txn Amount</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={7} className="td text-center py-6 text-ink-faint">No matched pairs yet.</td></tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id} className="hover:bg-brand-yellow-50/40">
                <td className="td">{fmtDate(l.statementDate)}</td>
                <td className="td">{l.description}</td>
                <td className="td text-right font-mono">{fmtINR(l.credit > 0 ? l.credit : l.debit)}</td>
                <td className="td font-mono">{l.matchedTxn?.txnNo ?? "—"}</td>
                <td className="td">{l.matchedTxn ? fmtDate(l.matchedTxn.date) : "—"}</td>
                <td className="td text-right font-mono">{l.matchedTxn ? fmtINR(l.matchedTxn.amount) : "—"}</td>
                <td className="td text-right">
                  <button onClick={() => onUnmatch(l.id)} className="rounded p-1 hover:bg-rose-50" title="Unmatch">
                    <Link2Off className="h-3.5 w-3.5 text-rose-600" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IgnoredTable({ lines }: { lines: StmtLine[] }) {
  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-xs font-bold">
        Ignored · {lines.length}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Description</th>
            <th className="th text-right">Debit</th>
            <th className="th text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={4} className="td text-center py-6 text-ink-faint">No ignored lines.</td></tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id} className="text-ink-mid">
                <td className="td">{fmtDate(l.statementDate)}</td>
                <td className="td">{l.description}</td>
                <td className="td text-right font-mono">{l.debit > 0 ? fmtINR(l.debit) : "—"}</td>
                <td className="td text-right font-mono">{l.credit > 0 ? fmtINR(l.credit) : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchModal({
  line,
  txns,
  onClose,
  onConfirm,
}: {
  line: StmtLine;
  txns: Txn[];
  onClose: () => void;
  onConfirm: (txnId: string) => void;
}) {
  const stmtAmount = line.credit > 0 ? line.credit : line.debit;
  const wantDirection = line.credit > 0 ? "CREDIT" : "DEBIT";
  const candidates = useMemo(() => {
    // Show closest amounts first.
    return [...txns]
      .filter((t) => {
        const dir = ["RECEIPT", "INTEREST"].includes(t.type) ? "CREDIT" : "DEBIT";
        return dir === wantDirection;
      })
      .sort((a, b) => Math.abs(a.amount - stmtAmount) - Math.abs(b.amount - stmtAmount));
  }, [txns, stmtAmount, wantDirection]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="card max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-2">
          <span className="text-sm font-bold">Match statement line</span>
          <button onClick={onClose} className="ml-auto text-xs text-ink-mid hover:text-ink">Esc</button>
        </div>
        <div className="px-4 py-3 border-b border-border bg-paper-cream/40 text-sm">
          <div className="font-mono">{fmtDate(line.statementDate)} · ₹{fmtINR(stmtAmount)} · {wantDirection}</div>
          <div className="text-ink-mid">{line.description}</div>
          {line.refNo && <div className="font-mono text-xs text-ink-mid">{line.refNo}</div>}
        </div>
        <div className="overflow-auto flex-1">
          {candidates.length === 0 ? (
            <div className="p-6 text-center text-ink-mid text-sm">No unreconciled book transactions in this direction. Record one first.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="th">Pick</th>
                  <th className="th">Date</th>
                  <th className="th">Txn No · Type</th>
                  <th className="th">Ref · Narration</th>
                  <th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((t) => {
                  const diff = Math.abs(t.amount - stmtAmount);
                  return (
                    <tr key={t.id} className="hover:bg-brand-yellow-50/40">
                      <td className="td">
                        <button onClick={() => onConfirm(t.id)} className="btn-primary text-xs py-0.5 px-2">Pick</button>
                      </td>
                      <td className="td">{fmtDate(t.date)}</td>
                      <td className="td font-mono">{t.txnNo} · {t.type}</td>
                      <td className="td">{t.refNo && <span className="font-mono">{t.refNo} · </span>}{t.narration}</td>
                      <td className={`td text-right font-mono font-bold ${diff < 0.01 ? "text-emerald-700" : ""}`}>{fmtINR(t.amount)}{diff > 0.01 ? <span className="text-[10px] text-ink-mid"> (Δ {fmtINR(diff)})</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
