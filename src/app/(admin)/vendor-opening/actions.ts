"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { getActiveCompanyId } from "@/lib/company";
import { parseFlexibleDate } from "@/lib/date";
import { ensureVendorCoA, setSubLedgerOpening, signedOpening } from "@/lib/accounting";

const MAX_IMPORT_ROWS = 5000;

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  return "";
}

export type VendorOpeningResult = {
  /** (vendor, model) rows written. */
  rowsSet: number;
  /** distinct vendors touched. */
  vendors: number;
  errors: string[];
  errorRows?: Record<string, string>[];
  needsConfirm?: boolean;
  existing?: number;
};

/**
 * Bulk-import per-model vendor opening balances DIRECTLY (independent of
 * inventory). One row = one (vendor, model) balance.
 *
 *   Vendor, Model, Opening Balance, Dr/Cr
 *
 * Stores VendorOpeningBalance rows (feeds the operational Vendor Ledger so the
 * OR / FTV Payment screens open from the right number) and sets each vendor's
 * Sundry Creditors GL sub-ledger opening = net CR−DR across its models.
 *
 * Re-running replaces ALL existing vendor opening balances (confirm-guarded).
 */
export async function bulkImportVendorOpening(
  rows: Record<string, string>[],
  confirmReplace = false,
  asOfIso?: string,
): Promise<VendorOpeningResult> {
  await requireEditor();
  if (rows.length === 0) return { rowsSet: 0, vendors: 0, errors: ["No rows"] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { rowsSet: 0, vendors: 0, errors: [`Batch too large — max ${MAX_IMPORT_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  const existing = await prisma.vendorOpeningBalance.count({ where: { companyId } });
  if (existing > 0 && !confirmReplace) {
    return { rowsSet: 0, vendors: 0, errors: [], needsConfirm: true, existing };
  }

  const defaultAsOf = (asOfIso && parseFlexibleDate(asOfIso)) || new Date();

  const [vendors, models] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    prisma.modelMaster.findMany({ where: { isActive: true }, select: { code: true } }),
  ]);
  const vByCode = new Map(vendors.filter((v) => v.code).map((v) => [v.code!.toUpperCase(), v]));
  const vByName = new Map(vendors.map((v) => [v.name.trim().toUpperCase(), v]));
  const validModels = new Set(models.map((m) => m.code.toUpperCase()));

  const errors: string[] = [];
  const errorRows: Record<string, string>[] = [];
  const fail = (rowNum: number, src: Record<string, string>, msg: string) => {
    errors.push(`Row ${rowNum}: ${msg}`);
    errorRows.push({ Row: String(rowNum), ...src, Error: msg });
  };

  type Draft = { vendorId: string; model: string; amount: number; drCr: string; asOf: Date };
  // key = vendorId|model — last row wins (one opening per vendor+model).
  const drafts = new Map<string, Draft>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (Object.values(r).every((v) => !v || !v.trim())) continue;

    const vRaw = pick(r, "Vendor", "vendor", "Vendor Code", "vendorCode", "Vendor Name").trim();
    if (!vRaw) { fail(rowNum, r, "Vendor required"); continue; }
    const vendor = vByCode.get(vRaw.toUpperCase()) ?? vByName.get(vRaw.toUpperCase());
    if (!vendor) { fail(rowNum, r, `vendor "${vRaw}" not found`); continue; }

    const model = pick(r, "Model", "model").toUpperCase().trim().replace(/-/g, "_");
    if (!validModels.has(model)) { fail(rowNum, r, `unknown model "${model || "(blank)"}"`); continue; }

    const amount = parseFloat(pick(r, "Opening Balance", "openingBalance", "Amount", "amount", "Balance"));
    if (!Number.isFinite(amount) || amount < 0) { fail(rowNum, r, "Opening Balance must be >= 0"); continue; }

    const drcrRaw = (pick(r, "Dr/Cr", "DrCr", "drCr", "Dr Cr", "Type") || "CR").trim().toUpperCase();
    const drCr = drcrRaw.startsWith("D") ? "DR" : drcrRaw.startsWith("C") ? "CR" : "";
    if (!drCr) { fail(rowNum, r, `Dr/Cr must be DR or CR (got "${drcrRaw}")`); continue; }

    const dateRaw = pick(r, "As Of", "asOf", "Date", "date").trim();
    const asOf = dateRaw ? parseFlexibleDate(dateRaw) : defaultAsOf;
    if (!asOf) { fail(rowNum, r, `invalid date "${dateRaw}"`); continue; }

    drafts.set(`${vendor.id}|${model}`, { vendorId: vendor.id, model, amount, drCr, asOf });
  }

  if (drafts.size === 0) {
    return { rowsSet: 0, vendors: 0, errors, errorRows };
  }

  // Replace: clear prior vendor openings (also reset their GL sub-ledger to 0).
  if (existing > 0) {
    const prior = await prisma.vendorOpeningBalance.findMany({ where: { companyId }, select: { vendorId: true } });
    const priorVendorIds = [...new Set(prior.map((p) => p.vendorId))];
    await prisma.vendorOpeningBalance.deleteMany({ where: { companyId } });
    for (const vId of priorVendorIds) {
      const v = await prisma.vendor.findUnique({ where: { id: vId }, select: { ledger: { select: { id: true } } } });
      if (v?.ledger) await setSubLedgerOpening(v.ledger.id, 0);
    }
  }

  let rowsSet = 0;
  const touched = new Set<string>();
  for (const d of drafts.values()) {
    await prisma.vendorOpeningBalance.create({
      data: { companyId, vendorId: d.vendorId, model: d.model, amount: d.amount, drCr: d.drCr, asOf: d.asOf },
    });
    rowsSet++;
    touched.add(d.vendorId);
  }

  // GL: each touched vendor's Sundry Creditors sub-ledger opening = net CR−DR.
  for (const vendorId of touched) {
    const obs = await prisma.vendorOpeningBalance.findMany({ where: { companyId, vendorId }, select: { amount: true, drCr: true } });
    const netCr = obs.reduce((s, x) => s + (x.drCr === "CR" ? x.amount : -x.amount), 0);
    const coa = await ensureVendorCoA(vendorId);
    if ("error" in coa) { errors.push(`GL sub-ledger failed for a vendor: ${coa.error}`); continue; }
    await setSubLedgerOpening(coa.accountId, signedOpening("LIABILITY", Math.abs(netCr), netCr >= 0 ? "CR" : "DR"));
  }

  await logWrite("VendorOpeningBalance", "bulk", "CREATE", null, { rowsSet, vendors: touched.size, replaced: existing });
  revalidatePath("/vendor-opening");
  revalidatePath("/ledger");
  revalidatePath("/payments");
  revalidatePath("/or-payments");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  return { rowsSet, vendors: touched.size, errors, errorRows };
}
