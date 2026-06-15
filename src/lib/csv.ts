import Papa from "papaparse";

/**
 * Escape any cell that starts with =, +, -, @, tab, or CR by prefixing a
 * single quote. Prevents formula injection when the CSV is re-opened in
 * Excel / Sheets.
 */
export function sanitizeCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  const c = value.charCodeAt(0);
  // = + - @  TAB  CR
  if (c === 61 || c === 43 || c === 45 || c === 64 || c === 9 || c === 13) {
    return `'${value}`;
  }
  return value;
}

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = sanitizeCell(v);
  return out;
}

export function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const result = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length > 0) {
    console.warn("CSV parse warnings:", result.errors.slice(0, 5));
  }
  return result.data;
}

/**
 * Headerless CSV → array of string arrays (one per row). Used when the file
 * has no header row and the caller knows the column order by position.
 */
export function parseCsvHeaderless(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return result.data;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  return Papa.unparse(rows.map(sanitizeRow), { columns: headers });
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
