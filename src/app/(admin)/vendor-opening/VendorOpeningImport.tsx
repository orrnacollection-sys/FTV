"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { Upload, Download } from "lucide-react";
import { bulkImportVendorOpening } from "./actions";

const COLS = ["Vendor", "Model", "Opening Balance", "Dr/Cr"];

/**
 * Imports per-model vendor opening balances directly (independent of stock).
 * One row = one (vendor, model). On any mismatch it downloads an error report.
 */
export function VendorOpeningImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    start(async () => {
      const run = async (confirmReplace: boolean) => {
        const res = await bulkImportVendorOpening(rows, confirmReplace);
        if (res.needsConfirm) {
          if (window.confirm(`⚠️ Vendor opening balances already exist (${res.existing} row(s)). Re-importing REPLACES all of them. Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — nothing changed");
          }
          return;
        }
        const msg = `${res.rowsSet} balance(s) set across ${res.vendors} vendor(s)` + (res.errors.length ? ` · ${res.errors.length} error(s)` : "");
        if (res.errorRows && res.errorRows.length > 0) {
          downloadCsv("vendor-opening-import-errors.csv", toCsv(res.errorRows, Object.keys(res.errorRows[0])));
          setResult(`${msg}. Error report downloaded (${res.errorRows.length} rows) — open it, read the "Error" column, fix those rows, and re-upload.`);
          toast.error(`${msg} — error report downloaded`);
        } else if (res.errors.length) {
          setResult(`${msg} — ${res.errors.slice(0, 5).join(" | ")}`);
          toast.error(msg);
        } else {
          setResult(`${msg}. ✓`);
          toast.success(msg);
        }
        router.refresh();
      };
      await run(false);
    });
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [
        { Vendor: "DHAJ", Model: "OR", "Opening Balance": "9000", "Dr/Cr": "CR" },
        { Vendor: "AVIG", Model: "OR", "Opening Balance": "7200", "Dr/Cr": "CR" },
        { Vendor: "AVIG", Model: "FTV", "Opening Balance": "3500", "Dr/Cr": "CR" },
      ],
      COLS,
    );
    downloadCsv("vendor-opening-template.csv", csv);
  };

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Import vendor opening balances"}
        </button>
        <button type="button" onClick={downloadTemplate} className="btn-secondary">
          <Download className="h-4 w-4" /> Template
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Columns: <span className="font-mono">Vendor, Model, Opening Balance, Dr/Cr</span>. One row per
        <span className="font-semibold"> vendor + model</span> — a vendor with both OR and FTV dues gets two rows.
        <span className="font-mono"> CR</span> = we owe the vendor (typical); <span className="font-mono">DR</span> = advance.
        This is the <span className="font-semibold">real</span> balance (pending + unsold + shipping + penalty + adjustments) — not derived from stock.
      </p>
      {result && (
        <div className="mt-2 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">
          {result}
        </div>
      )}
    </div>
  );
}
