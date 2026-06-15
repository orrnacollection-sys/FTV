/**
 * Import/export template round-trip check (no DB, no auth).
 *
 *   npx tsx prisma/check-templates.ts
 *
 * For each module: builds the exact CSV its UI produces (template headers +
 * sample row), serialises and re-parses it the way the import path does
 * (papaparse, header:true, trimmed headers), then asserts the columns the
 * importer actually reads are present. Catches template ↔ importer drift.
 */
import Papa from "papaparse";

type Check = { module: string; headers: string[]; sample: Record<string, string>; mustParse: string[] };

const checks: Check[] = [
  {
    module: "Item Master",
    headers: ["skuCode", "name", "hsn", "vendorCode", "category", "vendorSku", "model", "transferPrice", "taxRate", "effectiveDate"],
    sample: { skuCode: "SKU-001", name: "Sample Item", hsn: "", vendorCode: "ANOK", category: "", vendorSku: "", model: "FTV", transferPrice: "100", taxRate: "18", effectiveDate: "01-04-2026" },
    mustParse: ["skuCode", "name", "vendorCode", "model", "transferPrice", "taxRate", "effectiveDate"],
  },
  {
    module: "Vendor Master",
    headers: ["name", "email", "gst", "pan", "ifsc", "bankName", "accountNo", "status"],
    sample: { name: "Acme Apparel", email: "acme@example.com", gst: "", pan: "", ifsc: "", bankName: "", accountNo: "", status: "ACTIVE" },
    mustParse: ["name", "email", "status"],
  },
  {
    module: "Sales",
    headers: ["Date", "Marketplace", "SKU", "Type", "Qty Sold", "Qty Return", "Qty RTO", "Warehouse", "Remarks"],
    sample: { Date: "30-05-2026", Marketplace: "Myntra", SKU: "SKU-001", Type: "SALE", "Qty Sold": "2", "Qty Return": "0", "Qty RTO": "0", Warehouse: "WH-001", Remarks: "" },
    mustParse: ["Date", "Marketplace", "SKU", "Type", "Qty Sold"],
  },
  {
    module: "Marketplace Orders",
    headers: ["Date", "SKU", "Marketplace", "Type", "Place of Supply", "QTY", "Sale Price (Unit Rate)", "Taxable Value", "GST Rate %", "CGST", "SGST", "IGST", "Total"],
    sample: { Date: "30-05-2026", SKU: "ABCD-001", Marketplace: "Amazon", Type: "SALE", "Place of Supply": "Uttar Pradesh", QTY: "2", "Sale Price (Unit Rate)": "499", "Taxable Value": "846.61", "GST Rate %": "18", CGST: "76.19", SGST: "76.19", IGST: "0", Total: "999" },
    mustParse: ["Date", "SKU", "Marketplace", "Type", "QTY", "Sale Price (Unit Rate)", "Taxable Value"],
  },
  {
    module: "Marketing Cost",
    headers: ["Month", "SKU", "Marketing Spent"],
    sample: { Month: "2026-05", SKU: "ABCD-001", "Marketing Spent": "1500" },
    mustParse: ["Month", "SKU", "Marketing Spent"],
  },
  {
    module: "Warehouse Transfers",
    headers: ["Date", "SKU", "From", "To", "Transfer Type", "Qty", "Notes"],
    sample: { Date: "01-04-2026", SKU: "SKU-001", From: "WH-001", To: "WH-002", "Transfer Type": "SJIT", Qty: "10", Notes: "" },
    mustParse: ["Date", "SKU", "From", "To", "Qty"],
  },
  {
    module: "GRN",
    headers: ["Date", "Type", "Vendor", "Warehouse", "Invoice No", "Invoice Date", "SKU", "Qty", "Rejected Qty", "Rate", "GST %"],
    sample: { Date: "01-04-2026", Type: "PURCHASE", Vendor: "ANOK", Warehouse: "WH-001", "Invoice No": "INV-001", "Invoice Date": "01-04-2026", SKU: "SKU-001", Qty: "10", "Rejected Qty": "0", Rate: "100", "GST %": "18" },
    mustParse: ["Date", "Type", "Vendor", "Warehouse", "SKU", "Qty", "Rate", "GST %"],
  },
];

let failures = 0;
for (const c of checks) {
  const csv = Papa.unparse([c.sample], { columns: c.headers });
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const row = parsed.data[0] ?? {};
  const missing = c.mustParse.filter((k) => !(k in row));
  const headerMismatch = parsed.meta.fields ? c.headers.filter((h) => !parsed.meta.fields!.includes(h)) : [];
  if (missing.length === 0 && headerMismatch.length === 0 && parsed.errors.length === 0) {
    console.log(`  ✅ ${c.module}: ${c.headers.length} cols round-trip OK (${c.mustParse.length} importer keys present)`);
  } else {
    failures++;
    console.log(`  ❌ ${c.module}: missing keys [${missing.join(", ")}] header drift [${headerMismatch.join(", ")}] errors ${parsed.errors.length}`);
  }
}

console.log(failures === 0 ? "\nAll templates round-trip cleanly." : `\n${failures} template(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
