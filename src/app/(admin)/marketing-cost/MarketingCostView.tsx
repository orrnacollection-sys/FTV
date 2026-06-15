"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { importMarketingCost, bulkDeleteMarketingCost } from "./actions";
import { Upload, Download, FileSpreadsheet, Search, Megaphone, Trash2 } from "lucide-react";

type Row = { id: string; month: string; skuCode: string; itemName: string; amount: number };
type Filters = { q: string; month: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MarketingCostView({ rows, total, initial }: { rows: Row[]; total: number; initial: Filters }) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);
  const [importing, startImport] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["q", "month"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const run = async (confirmOverwrite: boolean) => {
        const res = await importMarketingCost(csvRows, confirmOverwrite);
        if (res.needsConfirm) {
          if (window.confirm(`⚠️ ${res.overwriteCount} existing SKU·month row(s) will be OVERWRITTEN with the new amounts. This cannot be undone. Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — no data changed");
          }
          return;
        }
        const msg = `Imported ${res.imported}, skipped ${res.skipped}${res.overwriteCount ? ` (${res.overwriteCount} overwritten)` : ""}`;
        if (res.errors.length > 0) toast.error(`${msg} — ${res.errors.slice(0, 3).join(" | ")}`);
        else toast.success(msg);
        router.refresh();
      };
      await run(false);
    });
  };

  const onTemplate = () => {
    const csv = toCsv(
      [{ Month: "2026-05", SKU: "ABCD-001", "Marketing Spent": "1500" }],
      ["Month", "SKU", "Marketing Spent"],
    );
    downloadCsv("marketing-cost-template.csv", csv);
  };

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({ Month: r.month, SKU: r.skuCode, Item: r.itemName, "Marketing Spent": r.amount })),
      ["Month", "SKU", "Item", "Marketing Spent"],
    );
    downloadCsv("marketing-cost.csv", csv);
  };

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () =>
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));

  const onDelete = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} row${selected.size === 1 ? "" : "s"}?`)) return;
    startDelete(async () => {
      const res = await bulkDeleteMarketingCost([...selected]);
      if ("error" in res) toast.error(res.error);
      else { toast.success(`Deleted ${res.count}`); setSelected(new Set()); router.refresh(); }
    });
  };

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Rows</div>
          <div className="font-display text-2xl font-bold tabular-nums">{rows.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total Marketing Spend</div>
          <div className="font-display text-2xl font-bold tabular-nums">₹{money(total)}</div>
        </div>
      </div>

      <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input type="search" placeholder="SKU or item name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="input pl-9" />
        </div>
        <input placeholder="Month (YYYY-MM)" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} className="input" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary">Apply</button>
        </div>
        <div className="sm:col-span-4 flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onImport(file); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
            <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
          </button>
          <button type="button" onClick={onTemplate} className="btn-secondary"><FileSpreadsheet className="h-4 w-4" /> Template</button>
          <button type="button" onClick={onExport} className="btn-secondary"><Download className="h-4 w-4" /> Export</button>
          {selected.size > 0 && (
            <button type="button" onClick={onDelete} disabled={deleting} className="btn-secondary text-red-700">
              <Trash2 className="h-4 w-4" /> Delete {selected.size}
            </button>
          )}
        </div>
      </form>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-8"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>
              <th className="th">Month</th>
              <th className="th">SKU</th>
              <th className="th">Item</th>
              <th className="th text-right">Marketing Spent</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Megaphone className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No marketing cost yet. Import Month · SKU · Marketing Spent.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                  <td className="td"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="td font-mono">{r.month}</td>
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td">{r.itemName}</td>
                  <td className="td text-right tabular-nums font-medium">{money(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
