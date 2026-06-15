"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createCategory, updateCategory, deleteCategory, bulkImportCategories } from "./actions";
import { toast } from "@/components/Toast";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { Trash2, Pencil, ChevronRight, Upload, Download, Search } from "lucide-react";

type Row = {
  id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  childCount: number;
};

type Node = Row & { children: Node[]; depth: number };

function buildTree(rows: Row[]): Node[] {
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) {
    const k = r.parentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(r);
  }
  const build = (parentId: string | null, depth: number): Node[] =>
    (byParent.get(parentId) ?? []).map((r) => ({
      ...r,
      depth,
      children: build(r.id, depth + 1),
    }));
  return build(null, 0);
}

function flatten(tree: Node[]): Node[] {
  const out: Node[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function CategoryManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tree = flatten(buildTree(rows));
  const idToName = new Map(rows.map((r) => [r.id, r.name]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (r: Row): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: Row | undefined = r;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };

  // No search → the tree (indented). Searching → flat list of matches with their
  // full path for context (client-side; the category count is small).
  const nq = search.trim().toLowerCase();
  type Disp = Row & { depth: number; path: string | null };
  const display: Disp[] = nq
    ? rows
        .map((r) => ({ ...r, depth: 0, path: pathOf(r) }))
        .filter((r) => r.name.toLowerCase().includes(nq) || (r.path ?? "").toLowerCase().includes(nq))
        .sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""))
    : tree.map((n) => ({ ...n, path: null }));

  // When editing, the parent dropdown must exclude the category itself and all
  // of its descendants (moving a node under its own child would be a cycle).
  const descendants = (catId: string): Set<string> => {
    const set = new Set<string>([catId]);
    const addKids = (pid: string) => {
      for (const r of rows) if (r.parentId === pid) { set.add(r.id); addKids(r.id); }
    };
    addKids(catId);
    return set;
  };
  const excluded = editingId ? descendants(editingId) : new Set<string>();

  const onExport = () => {
    const csv = toCsv(
      rows.map((r) => ({ name: r.name, parent: r.parentId ? (idToName.get(r.parentId) ?? "") : "" })),
      ["name", "parent"],
    );
    downloadCsv("categories.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [
        { name: "Jewellery", parent: "" },
        { name: "Bangles", parent: "Jewellery" },
        { name: "Kada", parent: "Bangles" },
      ],
      ["name", "parent"],
    );
    downloadCsv("categories-template.csv", csv);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const csvRows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await bulkImportCategories(csvRows);
      const msg = `${res.created} created` + (res.errors.length ? `, ${res.errors.length} error(s)` : "");
      if (res.errorRows && res.errorRows.length > 0) {
        downloadCsv("categories-import-errors.csv", toCsv(res.errorRows, Object.keys(res.errorRows[0])));
        setImportMsg(`${msg}. Error report downloaded — open it, read the "Error" column, fix those rows, and re-upload.`);
        toast.error(`${msg} — error report downloaded`);
      } else if (res.errors.length) {
        setImportMsg(`${msg} — ${res.errors.slice(0, 3).join(" | ")}`);
        toast.error(msg);
      } else {
        setImportMsg(null);
        toast.success(msg);
      }
      router.refresh();
    });
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("parentId", parentId);
    startTransition(async () => {
      const res = editingId ? await updateCategory(editingId, fd) : await createCategory(fd);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setName("");
      setParentId("");
      setEditingId(null);
      router.refresh();
    });
  };

  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setName(r.name);
    setParentId(r.parentId ?? "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName("");
    setParentId("");
    setError(null);
  };

  const onDelete = (id: string, label: string) => {
    if (!window.confirm(`Delete category "${label}"?`)) return;
    startTransition(async () => {
      const res = await deleteCategory(id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Deleted ${label}`);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-3 relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          placeholder="Search categories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`input pl-9 ${LIST_SEARCH_CLASS}`}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="btn-secondary">
          <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
        </button>
        <button type="button" onClick={onExport} className="btn-secondary">
          <Download className="h-4 w-4" /> Export CSV
        </button>
        <button type="button" onClick={downloadTemplate} className="btn-secondary">
          <Download className="h-4 w-4" /> Template
        </button>
        <span className="text-[11px] text-ink-faint">
          Columns: <b>name</b>, <b>parent</b> (parent category name — blank = top level).
        </span>
      </div>
      {importMsg && <div className="mb-3 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">{importMsg}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Category</th>
              <th className="th text-right">Items</th>
              <th className="th text-right">Subcats</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 ? (
              <tr>
                <td className="td text-center text-ink-faint" colSpan={4}>
                  {nq ? "No categories match." : "No categories yet."}
                </td>
              </tr>
            ) : (
              display.map((n) => (
                <tr key={n.id}>
                  <td className="td">
                    <span className="inline-flex items-center" style={{ paddingLeft: nq ? "0px" : `${n.depth * 18}px` }}>
                      {!nq && n.depth > 0 && <ChevronRight className="mr-1 h-3.5 w-3.5 text-ink-faint" />}
                      {nq ? n.path : n.name}
                    </span>
                  </td>
                  <td className="td text-right tabular-nums">{n.itemCount}</td>
                  <td className="td text-right tabular-nums">{n.childCount}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(n)}
                        className="rounded p-1.5 hover:bg-brand-yellow-pale"
                        title="Edit (rename / move)"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(n.id, n.name)}
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

      <form onSubmit={onSave} className="card p-5 h-fit">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
          {editingId ? "Edit category" : "Add category"}
        </div>
        <div className="mt-3">
          <label className="label">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input mt-1" required />
        </div>
        <div className="mt-3">
          <label className="label">Parent (optional)</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input mt-1">
            <option value="">— top level —</option>
            {tree.filter((n) => !excluded.has(n.id)).map((n) => (
              <option key={n.id} value={n.id}>
                {"  ".repeat(n.depth)}{n.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="mt-2 text-[11px] text-red-700">{error}</div>}
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={pending} className="btn-primary flex-1">
            {pending ? "Saving…" : editingId ? "Save changes" : "Add category"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="btn-secondary">Cancel</button>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}
