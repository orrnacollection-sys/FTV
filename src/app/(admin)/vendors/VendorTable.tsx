"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { bulkImportVendors, deleteVendor } from "./actions";
import { useRovingCursor } from "@/hooks/useRovingCursor";
import { toast } from "@/components/Toast";
import { Pencil, Trash2, Upload, Download, Search, Users } from "lucide-react";

type Vendor = {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  gst: string | null;
  gstRegType: string;
  pan: string | null;
  ifsc: string | null;
  bankName: string | null;
  accountNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  status: string;
};

export function VendorTable({
  vendors,
  initialQuery,
  initialStatus,
}: {
  vendors: Vendor[];
  initialQuery: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Live incremental find — filter the loaded vendors as the user types
  // (Tally-style), instead of a server round-trip per keystroke.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((v) => {
      if (status && v.status !== status) return false;
      if (!needle) return true;
      return (
        (v.code ?? "").toLowerCase().includes(needle) ||
        v.name.toLowerCase().includes(needle) ||
        (v.gst ?? "").toLowerCase().includes(needle) ||
        (v.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [q, status, vendors]);

  const openVendor = (v?: Vendor) => {
    if (!v) return;
    router.push(v.status === "PENDING" ? `/vendors/${v.id}/review` : `/vendors/${v.id}`);
  };

  // Tally-style row cursor: ↑/↓ move a yellow-highlighted row, Enter opens it.
  const { cursor, setCursor } = useRovingCursor({
    count: filtered.length,
    onActivate: (i) => openVendor(filtered[i]),
  });

  // Open the list with the cursor already in the search box, ready to type-to-find.
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Keep the highlighted row scrolled into view as the cursor moves.
  useEffect(() => {
    if (cursor < 0) return;
    document.querySelector(`[data-vrow="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Enter in the search box opens the highlighted row (or the top match) in
  // edit mode — Tally's "find, then drill in".
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    openVendor(cursor >= 0 ? filtered[cursor] : filtered[0]);
  };

  const handleExport = () => {
    const csv = toCsv(
      vendors.map((v) => ({
        name: v.name,
        email: v.email ?? "",
        gst: v.gst ?? "",
        gstRegType: v.gstRegType,
        pan: v.pan ?? "",
        ifsc: v.ifsc ?? "",
        bankName: v.bankName ?? "",
        accountNo: v.accountNo ?? "",
        address: v.address ?? "",
        city: v.city ?? "",
        state: v.state ?? "",
        pincode: v.pincode ?? "",
        country: v.country ?? "",
        status: v.status,
        code: v.code ?? "",
      })),
      ["name", "email", "gst", "gstRegType", "pan", "ifsc", "bankName", "accountNo", "address", "city", "state", "pincode", "country", "status", "code"],
    );
    downloadCsv("vendors.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{
        name: "Acme Apparel", code: "ACME", email: "acme@example.com",
        gst: "", gstRegType: "REGULAR", pan: "", ifsc: "", bankName: "", accountNo: "",
        address: "12 Sector 1", city: "Greater Noida", state: "Uttar Pradesh", pincode: "201310",
        country: "India",
        status: "ACTIVE",
      }],
      ["name", "code", "email", "gst", "gstRegType", "pan", "ifsc", "bankName", "accountNo", "address", "city", "state", "pincode", "country", "status"],
    );
    downloadCsv("vendors-template.csv", csv);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const run = async (confirmOverwrite: boolean) => {
        const result = await bulkImportVendors(rows, confirmOverwrite);
        if (result.needsConfirm) {
          if (window.confirm(`⚠️ ${result.overwriteCount} existing vendor(s) (matched by email) will be UPDATED with the imported details. Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — no data changed");
          }
          return;
        }
        const msg = `${result.created} created, ${result.updated} updated` +
          (result.errors.length ? `, ${result.errors.length} errors` : "");
        setImportResult(result.errors.length ? `${msg}: ${result.errors.slice(0, 3).join(" | ")}` : null);
        if (result.errors.length === 0) toast.success(msg);
        else toast.error(msg);
        router.refresh();
      };
      await run(false);
    });
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete vendor "${name}"? This cannot be undone.`)) return;
    try {
      await deleteVendor(id);
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch {
      toast.error("Delete failed — vendor may be in use");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={onSearch} className="flex flex-1 min-w-[240px] items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Type to find a vendor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  searchRef.current?.blur();
                  setCursor(filtered.length ? 0 : -1);
                }
              }}
              className="input pl-9 border-brand-yellow focus:border-brand-yellow-dark focus:ring-2 focus:ring-brand-yellow/60 focus:bg-brand-yellow-pale"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input max-w-[170px]">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending application</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <span className="hidden md:inline whitespace-nowrap text-[11px] text-ink-faint">
            <b>Enter</b> opens · <b>↓</b> to list
          </span>
        </form>

        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImport(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
          <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import CSV"}
        </button>
        <button type="button" className="btn-secondary" onClick={handleExport}>
          <Download className="h-4 w-4" /> Export CSV
        </button>
        <button type="button" className="btn-secondary" onClick={downloadTemplate}>
          <Download className="h-4 w-4" /> Template
        </button>
      </div>

      <p className="mb-3 text-[11px] text-ink-faint">
        Import columns: <b>name</b> is required; email is the match key for updates.
        Vendor code is generated automatically from the name. Use <b>Template</b> for the exact headers.
      </p>

      {importResult ? (
        <div className="mb-3 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">
          {importResult}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Code</th>
              <th className="th">Name</th>
              <th className="th">GST</th>
              <th className="th">PAN</th>
              <th className="th">IFSC</th>
              <th className="th">Bank</th>
              <th className="th">A/C No</th>
              <th className="th">Status</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Users className="h-10 w-10 opacity-40" />
                    <div className="text-sm">{q || status ? "No vendors match your search." : "No vendors yet."}</div>
                    <div className="text-xs">{q || status ? "Press Esc to clear, or Alt+C to create one." : "Import a CSV or create one with Alt+C."}</div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((v, i) => (
                <tr
                  key={v.id}
                  data-vrow={i}
                  onMouseEnter={() => setCursor(i)}
                  className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
                >
                  <td className="td font-mono text-xs">{v.code ?? <span className="text-ink-faint italic">pending</span>}</td>
                  <td className="td font-medium">{v.name}</td>
                  <td className="td">{v.gst ?? "—"}</td>
                  <td className="td">{v.pan ?? "—"}</td>
                  <td className="td">{v.ifsc ?? "—"}</td>
                  <td className="td">{v.bankName ?? "—"}</td>
                  <td className="td font-mono text-xs">{v.accountNo ?? "—"}</td>
                  <td className="td">
                    <span className={`badge ${
                      v.status === "ACTIVE"
                        ? "border-green-300 bg-green-50 text-green-800"
                        : v.status === "PENDING"
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-gray-300 bg-gray-50 text-gray-700"
                    }`}>{v.status}</span>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      {v.status === "PENDING" && (
                        <Link href={`/vendors/${v.id}/review`} className="btn-yellow !py-1 !px-2 !text-[11px]" title="Review application">
                          Review
                        </Link>
                      )}
                      <Link href={`/vendors/${v.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(v.id, v.name)}
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
    </>
  );
}
