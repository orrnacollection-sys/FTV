"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, useEffect, useRef } from "react";
import { toast } from "@/components/Toast";
import { toDisplayDate } from "@/lib/date";
import { DateField } from "@/components/DateField";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { useShortcut } from "@/hooks/useShortcut";
import { Plus, Trash2, X, Pencil, Search } from "lucide-react";
import { createJournalEntry, updateJournalEntry, deleteJournalEntry } from "../actions";

type Account = { id: string; code: string; name: string; type: string };
type Line = {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narration: string | null;
};
type Entry = {
  id: string;
  voucherNo: string;
  date: Date;
  narration: string | null;
  source: string;
  lines: Line[];
};

type DraftLine = { accountId: string; debit: string; credit: string; narration: string };
type Editing = { mode: "create" } | { mode: "edit"; id: string; voucherNo: string } | null;

const SOURCE_TONE: Record<string, string> = {
  MANUAL: "bg-gray-100 text-gray-700",
  AUTO_SALE: "bg-emerald-100 text-emerald-800",
  AUTO_GRN: "bg-blue-100 text-blue-800",
  AUTO_PAYMENT: "bg-amber-100 text-amber-800",
  AUTO_RECEIPT: "bg-violet-100 text-violet-800",
};

const emptyLines = (): DraftLine[] => [
  { accountId: "", debit: "", credit: "", narration: "" },
  { accountId: "", debit: "", credit: "", narration: "" },
];
const today = () => new Date().toISOString().slice(0, 10);

export function JournalView({
  accounts,
  entries,
  editEntry = null,
}: {
  accounts: Account[];
  entries: Entry[];
  editEntry?: Entry | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing>(null);
  const [q, setQ] = useState("");
  const [date, setDate] = useState(today());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(emptyLines());

  const totalDr = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;

  const startCreate = () => {
    setEditing({ mode: "create" });
    setDate(today());
    setNarration("");
    setLines(emptyLines());
  };

  const startEdit = (e: Entry) => {
    if (e.source !== "MANUAL") {
      toast.error(`${e.source} entries are auto-posted — undo them at the source document.`);
      return;
    }
    setEditing({ mode: "edit", id: e.id, voucherNo: e.voucherNo });
    setDate(new Date(e.date).toISOString().slice(0, 10));
    setNarration(e.narration ?? "");
    setLines(
      e.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit ? String(l.debit) : "",
        credit: l.credit ? String(l.credit) : "",
        narration: l.narration ?? "",
      })),
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setEditing(null);
    setDate(today());
    setNarration("");
    setLines(emptyLines());
  };

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: entries,
    search: q,
    matches: (e, n) =>
      e.voucherNo.toLowerCase().includes(n) ||
      (e.narration ?? "").toLowerCase().includes(n) ||
      e.source.toLowerCase().includes(n) ||
      e.lines.some((l) => l.accountCode.toLowerCase().includes(n) || l.accountName.toLowerCase().includes(n)),
    onOpen: (e) => startEdit(e),
  });

  // Drill-in from the Ledger explorer (/accounting/journal?edit=ID) opens the
  // voucher straight in the editor, once, on mount.
  const openedRef = useRef(false);
  useEffect(() => {
    if (editEntry && !openedRef.current) {
      openedRef.current = true;
      startEdit(editEntry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editEntry]);

  // Esc on a voucher you drilled into (from a report / ledger) retraces history
  // back to where you came from; on a plain inline edit it just closes the form.
  useShortcut(
    "escape",
    () => {
      if (editEntry) router.back();
      else resetForm();
    },
    { fireInInputs: true, enabled: editEntry != null || editing != null, label: "Back / Close", group: "Navigation" },
  );

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!balanced) { toast.error("Debits must equal credits"); return; }
    const cleaned = lines
      .map((l) => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        narration: l.narration || undefined,
      }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
    if (cleaned.length < 2) { toast.error("Need at least 2 lines"); return; }
    const mode = editing;
    startTransition(async () => {
      if (mode?.mode === "edit") {
        const res = await updateJournalEntry({ id: mode.id, date, narration: narration || undefined, lines: cleaned });
        if (!res.ok) { toast.error(res.error); return; }
        toast.success(`Updated ${res.voucherNo}`);
      } else {
        const res = await createJournalEntry({ date, narration: narration || undefined, lines: cleaned });
        if (!res.ok) { toast.error(res.error); return; }
        toast.success(`Posted ${res.voucherNo}`);
      }
      resetForm();
      router.refresh();
    });
  };

  const onDelete = (id: string, voucherNo: string) => {
    if (!window.confirm(`Delete ${voucherNo}? This reverses the postings.`)) return;
    startTransition(async () => {
      const res = await deleteJournalEntry(id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Deleted ${voucherNo}`);
      if (editing?.mode === "edit" && editing.id === id) resetForm();
      router.refresh();
    });
  };

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "", narration: "" }]);
  const removeLine = (idx: number) => setLines((ls) => (ls.length > 2 ? ls.filter((_, i) => i !== idx) : ls));

  const isEdit = editing?.mode === "edit";

  return (
    <div className="space-y-4">
      {/* Toolbar: search + New */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={searchKeyDown}
            placeholder="Type to find a voucher…"
            className={`input pl-9 ${LIST_SEARCH_CLASS}`}
          />
        </div>
        {!editing && (
          <button type="button" onClick={startCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> New Journal Entry
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {editing && (
        <form onSubmit={onSubmit} className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[.1em]">
              {isEdit ? `Edit ${editing.voucherNo}` : "New Journal Entry"}
            </div>
            <button type="button" onClick={resetForm} className="rounded p-1 hover:bg-brand-yellow-pale"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="label">Date<span className="text-red-600">*</span> <span className="text-[10px] font-normal text-ink-faint">(F2)</span></label>
              <DateField value={date} onChange={setDate} enableF2 required className="mt-1" />
            </div>
            <div className="sm:col-span-3">
              <label className="label">Narration</label>
              <input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What this entry is for" className="input mt-1" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              <div className="col-span-5">Account</div>
              <div className="col-span-2 text-right">Debit ₹</div>
              <div className="col-span-2 text-right">Credit ₹</div>
              <div className="col-span-2">Line narration</div>
              <div className="col-span-1" />
            </div>
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  value={l.accountId}
                  onChange={(e) => updateLine(idx, { accountId: e.target.value })}
                  className="input col-span-5 py-1.5 text-sm"
                >
                  <option value="">— pick account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name} ({a.type})
                    </option>
                  ))}
                </select>
                <input
                  type="number" min="0" step="0.01"
                  value={l.debit}
                  onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                  className="input col-span-2 py-1.5 text-right tabular-nums"
                />
                <input
                  type="number" min="0" step="0.01"
                  value={l.credit}
                  onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                  className="input col-span-2 py-1.5 text-right tabular-nums"
                />
                <input
                  value={l.narration}
                  onChange={(e) => updateLine(idx, { narration: e.target.value })}
                  placeholder="optional"
                  className="input col-span-2 py-1.5 text-sm"
                />
                <button
                  type="button" onClick={() => removeLine(idx)} disabled={lines.length <= 2}
                  className="col-span-1 rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-30"
                  title={lines.length <= 2 ? "Need at least 2 lines" : "Remove line"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addLine} className="mt-1 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-brand-yellow-pale">
              <Plus className="h-3 w-3" /> Add line
            </button>
          </div>

          {/* Balance check */}
          <div className={`rounded border p-3 text-sm ${balanced ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-amber-200 bg-amber-50/60 text-amber-900"}`}>
            Debits: <b className="font-mono tabular-nums">₹{totalDr.toFixed(2)}</b> ·
            Credits: <b className="font-mono tabular-nums">₹{totalCr.toFixed(2)}</b> ·
            Difference: <b className="font-mono tabular-nums">₹{(totalDr - totalCr).toFixed(2)}</b>
            {balanced ? " — balanced ✓" : " — must balance before posting"}
          </div>

          <div className="flex gap-2 border-t border-border pt-3">
            <button type="button" onClick={resetForm} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pending || !balanced} className="btn-primary">
              {pending ? "Saving…" : isEdit ? "Save Changes" : "Post Entry"}
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Voucher</th>
              <th className="th">Date</th>
              <th className="th">Source</th>
              <th className="th">Lines</th>
              <th className="th text-right">Total ₹</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="td py-10 text-center text-ink-faint">
                  {entries.length === 0
                    ? <>No journal entries yet. Click <b>New Journal Entry</b> to post your first one.</>
                    : "No vouchers match."}
                </td>
              </tr>
            ) : filtered.map((e, i) => {
              const total = e.lines.reduce((s, l) => s + l.debit, 0);
              const isManual = e.source === "MANUAL";
              return (
                <tr
                  key={e.id}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  className={`align-top ${i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}`}
                >
                  <td className="td font-mono text-xs font-bold">{e.voucherNo}</td>
                  <td className="td">{toDisplayDate(e.date)}</td>
                  <td className="td">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SOURCE_TONE[e.source] ?? "bg-gray-100"}`}>
                      {e.source}
                    </span>
                  </td>
                  <td className="td">
                    {e.narration && <div className="mb-1 text-xs italic text-ink-mid">{e.narration}</div>}
                    <table className="text-[11px]">
                      <tbody>
                        {e.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="pr-3 font-mono text-ink-mid">{l.accountCode}</td>
                            <td className="pr-3">{l.accountName}</td>
                            <td className="pr-3 text-right font-mono tabular-nums">{l.debit > 0 ? `Dr ${l.debit.toFixed(2)}` : ""}</td>
                            <td className="pr-3 text-right font-mono tabular-nums">{l.credit > 0 ? `Cr ${l.credit.toFixed(2)}` : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                  <td className="td text-right font-mono tabular-nums">{total.toFixed(2)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button" onClick={() => startEdit(e)}
                        disabled={pending || !isManual}
                        className="rounded p-1.5 hover:bg-brand-yellow-pale disabled:opacity-30"
                        title={isManual ? "Edit entry" : "Auto-posted entries are edited at their source"}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button" onClick={() => onDelete(e.id, e.voucherNo)}
                        disabled={pending || !isManual}
                        className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-30"
                        title={!isManual ? "Auto-posted entries can only be undone at source" : "Delete entry"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
