"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { useListNav, LIST_SEARCH_CLASS } from "@/hooks/useListNav";
import { bulkImportCustomers, deleteCustomer } from "./actions";
import { toast } from "@/components/Toast";
import { Pencil, Trash2, Upload, Download, Search, UsersRound } from "lucide-react";

type Customer = {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  gst: string | null;
  gstRegType: string;
  pan: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  priceTier: string;
  creditLimit: number | null;
  paymentTermsDays: number;
  salesRep: string | null;
  status: string;
};

export function CustomerTable({
  customers,
  initialQuery,
  initialStatus,
  initialTier,
}: {
  customers: Customer[];
  initialQuery: string;
  initialStatus: string;
  initialTier: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [tier, setTier] = useState(initialTier);
  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { filtered, cursor, setCursor, searchRef, searchKeyDown } = useListNav({
    items: customers,
    search: q,
    matches: (c, n) =>
      (c.code ?? "").toLowerCase().includes(n) ||
      c.name.toLowerCase().includes(n) ||
      (c.gst ?? "").toLowerCase().includes(n) ||
      (c.email ?? "").toLowerCase().includes(n) ||
      (c.mobile ?? "").toLowerCase().includes(n) ||
      (c.pan ?? "").toLowerCase().includes(n) ||
      (c.city ?? "").toLowerCase().includes(n) ||
      (c.state ?? "").toLowerCase().includes(n),
    onOpen: (c) => router.push(`/customers/${c.id}`),
  });

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    if (status) url.searchParams.set("status", status); else url.searchParams.delete("status");
    if (tier) url.searchParams.set("tier", tier); else url.searchParams.delete("tier");
    router.push(url.pathname + url.search);
  };

  const handleExport = () => {
    const csv = toCsv(
      customers.map((c) => ({
        name: c.name,
        code: c.code ?? "",
        email: c.email ?? "",
        mobile: c.mobile ?? "",
        gst: c.gst ?? "",
        gstRegType: c.gstRegType,
        pan: c.pan ?? "",
        city: c.city ?? "",
        state: c.state ?? "",
        pincode: c.pincode ?? "",
        country: c.country ?? "",
        priceTier: c.priceTier,
        creditLimit: c.creditLimit ?? "",
        paymentTermsDays: c.paymentTermsDays,
        salesRep: c.salesRep ?? "",
        status: c.status,
      })),
      [
        "name", "code", "email", "mobile", "gst", "gstRegType", "pan",
        "city", "state", "pincode", "country",
        "priceTier", "creditLimit", "paymentTermsDays", "salesRep", "status",
      ],
    );
    downloadCsv("customers.csv", csv);
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{
        name: "Westside Mumbai", code: "WST-001",
        email: "buyer@westside.example", mobile: "9876543210",
        gst: "27AAAAA0000A1Z5", gstRegType: "REGULAR", pan: "AAAAA0000A",
        address: "Andheri East", city: "Mumbai", state: "Maharashtra", pincode: "400069", country: "India",
        priceTier: "WHOLESALE", creditLimit: "500000", paymentTermsDays: "30",
        salesRep: "Priya", status: "ACTIVE",
      }],
      [
        "name", "code", "email", "mobile", "gst", "gstRegType", "pan",
        "address", "city", "state", "pincode", "country",
        "priceTier", "creditLimit", "paymentTermsDays", "salesRep", "status",
      ],
    );
    downloadCsv("customers-template.csv", csv);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const run = async (confirmOverwrite: boolean) => {
        const result = await bulkImportCustomers(rows, confirmOverwrite);
        if (result.needsConfirm) {
          if (window.confirm(
            `⚠️ ${result.overwriteCount} existing customer(s) (matched by email) will be UPDATED with the imported details. Continue?`,
          )) {
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
    if (!window.confirm(`Delete customer "${name}"? This cannot be undone.`)) return;
    try {
      await deleteCustomer(id);
      toast.success(`Deleted ${name}`);
      router.refresh();
    } catch {
      toast.error("Delete failed — customer may be in use");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={onSearch} className="flex flex-1 min-w-[280px] items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Type to find a customer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={searchKeyDown}
              className={`input pl-9 ${LIST_SEARCH_CLASS}`}
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input max-w-[160px]">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended (hold)</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="input max-w-[160px]">
            <option value="">All tiers</option>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="DISTRIBUTOR">Distributor</option>
            <option value="MARKETPLACE">Marketplace</option>
          </select>
          <button type="submit" className="btn-secondary">Filter</button>
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
        Import columns: <b>name</b> is required; <b>email</b> is the match key for updates.
        Use <b>Template</b> for the exact headers.
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
              <th className="th">Location</th>
              <th className="th">Tier</th>
              <th className="th text-right">Credit Limit</th>
              <th className="th text-right">Terms</th>
              <th className="th">Status</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <UsersRound className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No customers yet.</div>
                    <div className="text-xs">Import a CSV or create one from the top right.</div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((c, i) => {
                const loc = [c.city, c.state].filter(Boolean).join(", ");
                return (
                  <tr
                    key={c.id}
                    data-list-row={i}
                    onMouseEnter={() => setCursor(i)}
                    className={i === cursor ? "bg-brand-yellow-light" : "hover:bg-brand-yellow-50/40"}
                  >
                    <td className="td font-mono text-xs">{c.code ?? <span className="text-ink-faint italic">—</span>}</td>
                    <td className="td font-medium">{c.name}</td>
                    <td className="td font-mono text-xs">{c.gst ?? "—"}</td>
                    <td className="td text-ink-mid">{loc || "—"}</td>
                    <td className="td">
                      <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800">
                        {c.priceTier}
                      </span>
                    </td>
                    <td className="td text-right font-mono text-xs">
                      {c.creditLimit != null ? `₹${c.creditLimit.toLocaleString("en-IN")}` : <span className="text-ink-faint">no cap</span>}
                    </td>
                    <td className="td text-right text-xs">
                      {c.paymentTermsDays === 0 ? <span className="text-ink-faint">COD</span> : `Net ${c.paymentTermsDays}`}
                    </td>
                    <td className="td">
                      <span className={`badge ${
                        c.status === "ACTIVE"
                          ? "border-green-300 bg-green-50 text-green-800"
                          : c.status === "SUSPENDED"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-gray-300 bg-gray-50 text-gray-700"
                      }`}>{c.status}</span>
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/customers/${c.id}`} className="rounded p-1.5 hover:bg-brand-yellow-pale" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id, c.name)}
                          className="rounded p-1.5 text-red-700 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
