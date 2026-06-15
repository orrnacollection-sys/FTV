"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { toast } from "@/components/Toast";
import { Upload, Download } from "lucide-react";
import { bulkImportItemsWithStock } from "./actions";

const COLS = ["SKU Code", "Name", "HSN", "Category", "Vendor", "Model", "Rate", "GST %", "Opening Qty", "Payment", "Warehouse Code", "Date"];

/**
 * Combined go-live importer: one CSV that creates the Item Master AND its
 * opening inventory. One row = one lot; repeat the SKU on more rows for more
 * vendors/costs. Item identity (Name/HSN/Category) is taken from the first row
 * per SKU. Blank Opening Qty = create the item only. On any mismatch it
 * downloads an error report (original columns + an Error column).
 */
export function ItemStockImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const onImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv<Record<string, string>>(text);
    start(async () => {
      const run = async (confirmReplace: boolean) => {
        const res = await bulkImportItemsWithStock(rows, confirmReplace);
        if (res.needsConfirm) {
          if (window.confirm(`⚠️ Opening stock already exists (${res.existingGrns} GRN(s)). Re-importing REPLACES all opening stock (items are updated, not deleted). Continue?`)) {
            await run(true);
          } else {
            toast.error("Import cancelled — nothing changed");
          }
          return;
        }
        const msg = `${res.itemsCreated} item(s) created, ${res.itemsUpdated} updated · ${res.grns} opening GRN(s), ${res.lines} lot(s)` + (res.errors.length ? ` · ${res.errors.length} error(s)` : "");
        if (res.errorRows && res.errorRows.length > 0) {
          downloadCsv("item-stock-import-errors.csv", toCsv(res.errorRows, Object.keys(res.errorRows[0])));
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
        { "SKU Code": "FTNS1007", Name: "Avighna Kada", HSN: "7117", Category: "", Vendor: "AVIG", Model: "FTV", Rate: "220", "GST %": "3", "Opening Qty": "50", Payment: "PAID", "Warehouse Code": "", Date: "31-03-2026" },
        { "SKU Code": "FTNS1007", Name: "Avighna Kada", HSN: "7117", Category: "", Vendor: "DHAJ", Model: "OR", Rate: "240", "GST %": "3", "Opening Qty": "30", Payment: "PENDING", "Warehouse Code": "", Date: "31-03-2026" },
      ],
      COLS,
    );
    downloadCsv("item-opening-stock-template.csv", csv);
  };

  return (
    <div className="card border-[1.5px] border-brand-yellow-light p-4">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[.1em] text-brand-yellow-dark">Go-live one-shot</div>
      <h2 className="font-display text-lg font-bold">Import Items + Opening Stock</h2>
      <p className="mt-1 text-xs text-ink-faint">
        One CSV that <span className="font-semibold">creates the items</span> and <span className="font-semibold">loads their opening stock</span> together.
        One row = one lot; repeat a SKU on more rows for more vendors/costs (pooled). Item Name/HSN/Category come from the first row per SKU.
        Blank <span className="font-mono">Opening Qty</span> = create the item only. Vendors must already exist.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ""; }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary">
          <Upload className="h-4 w-4" /> {busy ? "Importing…" : "Import Items + Stock"}
        </button>
        <button type="button" onClick={downloadTemplate} className="btn-secondary">
          <Download className="h-4 w-4" /> Template
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Columns: <span className="font-mono">SKU Code, Name, HSN, Category, Vendor, Model, Rate, GST %, Opening Qty, Payment, Warehouse Code, Date</span>
      </p>
      {result && (
        <div className="mt-2 rounded border border-brand-yellow-light bg-brand-yellow-50 px-3 py-2 text-xs">
          {result}
        </div>
      )}
    </div>
  );
}
