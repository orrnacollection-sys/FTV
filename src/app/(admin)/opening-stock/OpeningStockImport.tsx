"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { Upload, Download } from "lucide-react";
import { bulkImportOpeningStock } from "./actions";

const TEMPLATE_COLS = ["SKU", "Vendor", "Qty", "Cost", "Model", "GST %", "Warehouse Code", "Payment", "Date"];

/**
 * Opening-stock CSV importer. One row = one lot (SKU from a vendor at a cost,
 * marked PAID or PENDING). Rows group into Opening GRNs by vendor + payment +
 * date + warehouse. On any mismatch it downloads an error report (original
 * columns + an Error column) the same way the Item Master import does.
 */
export function OpeningStockImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    start(async () => {
      const run = async (confirmReplace: boolean) => {
        const res = await bulkImportOpeningStock(rows, confirmReplace);
        if (res.needsConfirm) {
          if (window.confirm(`⚠️ Opening stock already exists (${res.existingGrns} opening GRN(s)). Re-importing REPLACES all of it. Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — nothing changed");
          }
          return;
        }
        const msg = `${res.grns} opening GRN(s), ${res.lines} lot(s) loaded` + (res.errors.length ? `, ${res.errors.length} error(s)` : "");
        if (res.errorRows && res.errorRows.length > 0) {
          downloadCsv("opening-stock-import-errors.csv", toCsv(res.errorRows, Object.keys(res.errorRows[0])));
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
        { SKU: "FTNS1007", Vendor: "AVIG", Qty: "50", Cost: "220", Model: "FTV", "GST %": "3", "Warehouse Code": "WH-001", Payment: "PAID", Date: "31-03-2026" },
        { SKU: "FTNS1007", Vendor: "DHAJ", Qty: "30", Cost: "240", Model: "OR", "GST %": "3", "Warehouse Code": "WH-001", Payment: "PENDING", Date: "31-03-2026" },
      ],
      TEMPLATE_COLS,
    );
    downloadCsv("opening-stock-template.csv", csv);
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
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Import opening stock"}
        </button>
        <button type="button" onClick={downloadTemplate} className="btn-secondary">
          <Download className="h-4 w-4" /> Template
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Columns: <span className="font-mono">SKU, Vendor, Qty, Cost, Model, GST %, Warehouse Code, Payment, Date</span>.
        Each row is one lot. The same SKU can appear under several vendors at different costs (pooled stock).
        <span className="font-semibold"> Payment</span> = <span className="font-mono">PAID</span> (already settled) or
        <span className="font-mono"> PENDING</span> (still owed).
        <span className="font-semibold"> Warehouse Code</span> — use a code from Warehouse Master. If you have only one
        warehouse, you can leave it blank and that warehouse is used automatically.
      </p>
      {result && (
        <div className="mt-2 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">
          {result}
        </div>
      )}
    </div>
  );
}
