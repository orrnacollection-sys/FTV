"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toDisplayDate } from "@/lib/date";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { addPriceRevision, bulkImportItems, deleteItem } from "./actions";
import { ImagePopup } from "./ImagePopup";
import { toast } from "@/components/Toast";
import { Pencil, Trash2, Upload, Download, Search, ExternalLink, Package, IndianRupee, X } from "lucide-react";

type Row = {
  id: string;
  skuCode: string;
  name: string;
  hsn: string | null;
  imageUrl: string | null;
  itemType: string;
  model: string | null;
  vendorCode: string | null;
  vendorName: string;
  categoryName: string | null;
  transferPrice: number | null;
  taxRate: number | null;
  effectiveDate: Date | string | null;
};

type CategoryOption = { id: string; name: string; path: string };
type VendorOption = { id: string; code: string | null; name: string };
type ModelOption = { code: string; label: string };
type Filters = { q: string; categoryId: string; vendorId: string; model: string };

export function ItemTable({
  rows,
  categories,
  vendors,
  models,
  initial,
  total,
  page,
  pageCount,
}: {
  rows: Row[];
  categories: CategoryOption[];
  vendors: VendorOption[];
  models: ModelOption[];
  initial: Filters;
  total: number;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [priceFor, setPriceFor] = useState<Row | null>(null);
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL-driven filtering: change the query string → the server re-queries ONE
  // page. Resets to page 1 on any filter change (page kept only when paging).
  const updateUrl = (updates: Record<string, string>, resetPage = true) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(updates)) {
      if (v) url.searchParams.set(k, v); else url.searchParams.delete(k);
    }
    if (resetPage) url.searchParams.delete("page");
    router.replace(url.pathname + url.search, { scroll: false });
  };

  // Live (debounced) type-ahead — feels like Tally, but the database does the
  // matching, so it scales to any catalog size.
  const onSearch = (val: string) => {
    setQ(val);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => updateUrl({ q: val }), 200);
  };

  // useListNav drives ONLY the keyboard row-cursor over the loaded page — no
  // client-side filtering (the server already returned the matching rows).
  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: rows,
    search: "",
    matches: () => true,
    onOpen: (r) => router.push(`/items/${r.id}`),
  });

  const modelLabel = (code: string | null) =>
    code ? (models.find((m) => m.code === code)?.label ?? code.replace("_", "-")) : "—";

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({
        skuCode: r.skuCode,
        name: r.name,
        hsn: r.hsn ?? "",
        vendorCode: r.vendorCode ?? "",
        vendorName: r.vendorName,
        model: r.model ?? "",
        category: r.categoryName ?? "",
        transferPrice: r.transferPrice ?? "",
        taxRate: r.taxRate ?? "",
        effectiveDate: r.effectiveDate ? toDisplayDate(r.effectiveDate) : "",
      })),
      ["skuCode", "name", "hsn", "vendorCode", "vendorName", "model", "category", "transferPrice", "taxRate", "effectiveDate"],
    );
    downloadCsv("items.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{ skuCode: "SKU-001", name: "Sample Item", hsn: "", vendorCode: "ANOK", category: "", vendorSku: "", model: "FTV", transferPrice: "100", taxRate: "18", effectiveDate: "01-04-2026" }],
      ["skuCode", "name", "hsn", "vendorCode", "category", "vendorSku", "model", "transferPrice", "taxRate", "effectiveDate"],
    );
    downloadCsv("items-template.csv", csv);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const run = async (confirmOverwrite: boolean) => {
        const res = await bulkImportItems(csvRows, confirmOverwrite);
        if (res.needsConfirm) {
          if (window.confirm(`⚠️ ${res.overwriteCount} existing SKU(s) will be UPDATED (name/HSN/category/vendor overwritten; a new price revision added if the price changed). Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — no data changed");
          }
          return;
        }
        const msg = `${res.created} created, ${res.updated} updated` + (res.errors.length ? `, ${res.errors.length} error(s)` : "");
        if (res.errorRows && res.errorRows.length > 0) {
          // Hand back a downloadable error report: original columns + an Error
          // column explaining each rejected row, so it can be fixed and re-uploaded.
          const headers = Object.keys(res.errorRows[0]);
          downloadCsv(`item-import-errors.csv`, toCsv(res.errorRows, headers));
          setImportResult(`${msg}. Error report downloaded (${res.errorRows.length} rows) — open it, read the "Error" column, fix those rows, and re-upload.`);
          toast.error(`${msg} — error report downloaded`);
        } else if (res.errors.length) {
          setImportResult(`${msg} — ${res.errors.slice(0, 5).join(" | ")}`);
          toast.error(msg);
        } else {
          setImportResult(null);
          toast.success(msg);
        }
        router.refresh();
      };
      await run(false);
    });
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete item "${name}"? This cannot be undone.`)) return;
    try {
      await deleteItem(id);
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <>
      <div className="mb-3 card p-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        <div className="md:col-span-2 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Type to find a SKU…"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={searchKeyDown}
            className={`input pl-9 ${LIST_SEARCH_CLASS}`}
          />
        </div>
        <select value={initial.categoryId} onChange={(e) => updateUrl({ categoryId: e.target.value })} className="input">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
        </select>
        <select value={initial.vendorId} onChange={(e) => updateUrl({ vendorId: e.target.value })} className="input">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>)}
        </select>
        <select value={initial.model} onChange={(e) => updateUrl({ model: e.target.value })} className="input">
          <option value="">All models</option>
          {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void onImport(file); e.target.value = ""; }}
        />
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
          <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
        </button>
        <button type="button" className="btn-secondary" onClick={onExport}>
          <Download className="h-4 w-4" /> Export page
        </button>
        <button type="button" className="btn-secondary" onClick={downloadTemplate}>
          <Download className="h-4 w-4" /> Template
        </button>
        <span className="text-[11px] text-ink-faint">
          Import keys: <b>skuCode</b>, <b>name</b>, <b>vendorCode</b>, <b>transferPrice</b>, <b>taxRate</b>, <b>effectiveDate</b> required. SKU is the match key for updates.
        </span>
      </div>

      {importResult ? (
        <div className="mb-3 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">{importResult}</div>
      ) : null}

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Image</th>
              <th className="th">SKU Code</th>
              <th className="th">Name</th>
              <th className="th">HSN</th>
              <th className="th">Vendor</th>
              <th className="th">Model</th>
              <th className="th">Category</th>
              <th className="th text-right">Rate</th>
              <th className="th text-right">GST %</th>
              <th className="th">Effective</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Package className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No items match.</div>
                    <div className="text-xs">Create one, import a CSV, or relax the filters.</div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr
                  key={r.id}
                  data-list-row={i}
                  onMouseEnter={() => setCursor(i)}
                  className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
                >
                  <td className="td">
                    {r.imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreview({ src: r.imageUrl!, alt: r.name })}
                        className="block rounded border border-border overflow-hidden hover:ring-2 hover:ring-brand-yellow-dark"
                        title="Click to enlarge"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.imageUrl} alt={r.name} className="h-10 w-10 object-cover" />
                      </button>
                    ) : (
                      <div className="h-10 w-10 rounded border border-dashed border-border bg-surface-gray-100" />
                    )}
                  </td>
                  <td className="td font-mono text-xs">{r.skuCode}</td>
                  <td className="td font-medium">
                    {r.name}
                    {r.itemType === "SERVICE" && (
                      <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Service</span>
                    )}
                  </td>
                  <td className="td">{r.hsn ?? "—"}</td>
                  <td className="td">
                    <div>{r.vendorName}</div>
                    <div className="text-[10px] text-ink-faint font-mono">{r.vendorCode ?? "—"}</div>
                  </td>
                  <td className="td">{modelLabel(r.model)}</td>
                  <td className="td">{r.categoryName ?? "—"}</td>
                  <td className="td text-right tabular-nums">
                    {r.transferPrice != null ? r.transferPrice.toFixed(2) : "—"}
                  </td>
                  <td className="td text-right tabular-nums">{r.taxRate != null ? `${r.taxRate}%` : "—"}</td>
                  <td className="td">{toDisplayDate(r.effectiveDate)}</td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setPriceFor(r)}
                        className="rounded p-1.5 hover:bg-brand-yellow-pale"
                        title="Update price (keeps history)"
                      >
                        <IndianRupee className="h-4 w-4" />
                      </button>
                      {r.imageUrl && (
                        <a
                          href={r.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1.5 hover:bg-brand-yellow-pale"
                          title="Open image in new tab"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <Link href={`/items/${r.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDelete(r.id, r.name)}
                        className="rounded p-1.5 text-red-700 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageCount={pageCount} total={total} onGo={(p) => updateUrl({ page: String(p) }, false)} />

      {preview && <ImagePopup src={preview.src} alt={preview.alt} onClose={() => setPreview(null)} />}
      {priceFor && <PriceModal row={priceFor} models={models} onClose={() => setPriceFor(null)} onSaved={() => { setPriceFor(null); router.refresh(); }} />}
    </>
  );
}

function Pager({ page, pageCount, total, onGo }: { page: number; pageCount: number; total: number; onGo: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const from = Math.max(1, page - 2);
  const to = Math.min(pageCount, page + 2);
  const nums: number[] = [];
  for (let i = from; i <= to; i++) nums.push(i);
  const btn = "rounded border border-border px-3 py-1 text-sm disabled:opacity-40 hover:bg-brand-yellow-50";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
      <span className="mr-2 text-xs text-ink-faint">{total.toLocaleString("en-IN")} total</span>
      <button type="button" disabled={page <= 1} onClick={() => onGo(page - 1)} className={btn}>‹ Prev</button>
      {from > 1 && <button type="button" onClick={() => onGo(1)} className={btn}>1</button>}
      {from > 2 && <span className="px-1 text-ink-faint">…</span>}
      {nums.map((n) => (
        <button key={n} type="button" onClick={() => onGo(n)} className={`rounded px-3 py-1 text-sm ${n === page ? "bg-brand-black text-white" : "border border-border hover:bg-brand-yellow-50"}`}>{n}</button>
      ))}
      {to < pageCount - 1 && <span className="px-1 text-ink-faint">…</span>}
      {to < pageCount && <button type="button" onClick={() => onGo(pageCount)} className={btn}>{pageCount}</button>}
      <button type="button" disabled={page >= pageCount} onClick={() => onGo(page + 1)} className={btn}>Next ›</button>
    </div>
  );
}

function PriceModal({ row, models, onClose, onSaved }: { row: Row; models: ModelOption[]; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await addPriceRevision(fd);
      if ("error" in res && res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Price updated");
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Update terms</h2>
            <p className="text-xs text-ink-faint font-mono">{row.skuCode} · {row.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input type="hidden" name="itemId" value={row.id} />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Model <span className="text-red-600">*</span></label>
            <select name="model" defaultValue={row.model ?? ""} required className="input mt-1">
              <option value="">— select model —</option>
              {models.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
            {errors.model && <p className="mt-1 text-xs text-rose-600">{errors.model}</p>}
          </div>
          <div>
            <label className="label">Transfer price <span className="text-red-600">*</span></label>
            <input
              name="transferPrice"
              type="number"
              min="0"
              step="0.01"
              defaultValue={row.transferPrice ?? ""}
              required
              autoFocus
              className="input mt-1 text-right tabular-nums"
            />
            {errors.transferPrice && <p className="mt-1 text-xs text-rose-600">{errors.transferPrice}</p>}
          </div>
          <div>
            <label className="label">GST % <span className="text-red-600">*</span></label>
            <input
              name="taxRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={row.taxRate ?? ""}
              required
              className="input mt-1 text-right tabular-nums"
            />
            {errors.taxRate && <p className="mt-1 text-xs text-rose-600">{errors.taxRate}</p>}
          </div>
          <div className="col-span-2">
            <label className="label">Effective date <span className="text-red-600">*</span></label>
            <input name="effectiveDate" type="date" defaultValue={today} required className="input mt-1" />
            {errors.effectiveDate && <p className="mt-1 text-xs text-rose-600">{errors.effectiveDate}</p>}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Adds a new price revision — older rates stay in history and remain effective for past-dated vouchers.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save price"}</button>
        </div>
      </form>
    </div>
  );
}
