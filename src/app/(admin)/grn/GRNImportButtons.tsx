"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { Upload, Download } from "lucide-react";
import { bulkImportGRNs } from "./actions";

/**
 * Import-CSV + Template buttons for the GRN list header.
 *
 * Template: emits a single example row with the columns the importer reads
 * (Date, Type, Vendor, Warehouse, Invoice No / Date, SKU, Qty, Rate, GST %).
 * Rows with the same Vendor + Type + Date + Invoice No collapse into one GRN at
 * import time. (A legacy "Rejected Qty" column is still accepted on import for
 * back-compat but is no longer part of the template.)
 */
export function GRNImportButtons() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, startImport] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    startImport(async () => {
      const res = await bulkImportGRNs(rows);
      const msg = `${res.created} GRN${res.created === 1 ? "" : "s"} created` +
        (res.errors.length ? `, ${res.errors.length} error${res.errors.length === 1 ? "" : "s"}` : "");
      if (res.errors.length === 0) {
        setResult(null);
        toast.success(msg);
      } else {
        // Show the first few errors so the user can correct the CSV and re-run.
        setResult(`${msg} — ${res.errors.slice(0, 5).join(" | ")}`);
        toast.error(msg);
      }
      router.refresh();
    });
  };

  const downloadTemplate = () => {
    const csv = toCsv(
      [{
        Date: "01-04-2026",
        Type: "PURCHASE",
        Vendor: "ANOK",
        Warehouse: "WH-001",
        "Invoice No": "INV-001",
        "Invoice Date": "01-04-2026",
        SKU: "SKU-001",
        Qty: "10",
        Rate: "100",
        "GST %": "18",
      }],
      ["Date", "Type", "Vendor", "Warehouse", "Invoice No", "Invoice Date", "SKU", "Qty", "Rate", "GST %"],
    );
    downloadCsv("grn-template.csv", csv);
  };

  return (
    <>
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
      <button type="button" onClick={downloadTemplate} className="btn-secondary">
        <Download className="h-4 w-4" /> Template
      </button>
      {result && (
        <div className="mt-2 w-full rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">
          {result}
        </div>
      )}
    </>
  );
}
