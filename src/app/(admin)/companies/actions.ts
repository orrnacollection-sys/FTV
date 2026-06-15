"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { setActiveCompanyId, MULTI_COMPANY_ENABLED } from "@/lib/company";
import { hasFeature, seatsAvailable, FEATURES } from "@/lib/licensing";

type Result = { ok: true; id?: string } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** The 50-account standard Chart of Accounts seed — same shape as
 *  `prisma/seed.ts` uses for the primary company. Replicated per
 *  new company so each one has a clean ledger from day 1. */
const STANDARD_COA: Array<{ code: string; name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY"; subType?: string; parent?: string }> = [
  { code: "1000", name: "Assets", type: "ASSET" },
  { code: "1100", name: "Current Assets", type: "ASSET", subType: "CURRENT_ASSET", parent: "1000" },
  { code: "1110", name: "Cash in Hand", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1120", name: "Bank Accounts", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1130", name: "Sundry Debtors", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1140", name: "Inventory / Stock-in-Trade", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1150", name: "Input GST Credit", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1160", name: "TDS Receivable", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1170", name: "Advance to Suppliers", type: "ASSET", subType: "CURRENT_ASSET", parent: "1100" },
  { code: "1200", name: "Fixed Assets", type: "ASSET", subType: "FIXED_ASSET", parent: "1000" },
  { code: "1210", name: "Computers & Equipment", type: "ASSET", subType: "FIXED_ASSET", parent: "1200" },
  { code: "1220", name: "Furniture & Fixtures", type: "ASSET", subType: "FIXED_ASSET", parent: "1200" },
  { code: "1230", name: "Vehicles", type: "ASSET", subType: "FIXED_ASSET", parent: "1200" },
  { code: "1240", name: "Accumulated Depreciation (contra)", type: "ASSET", subType: "FIXED_ASSET", parent: "1200" },
  { code: "2000", name: "Liabilities", type: "LIABILITY" },
  { code: "2100", name: "Current Liabilities", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2000" },
  { code: "2110", name: "Sundry Creditors", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2100" },
  { code: "2120", name: "GST Payable", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2100" },
  { code: "2130", name: "TDS Payable", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2100" },
  { code: "2140", name: "Salary Payable", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2100" },
  { code: "2150", name: "Other Current Liabilities", type: "LIABILITY", subType: "CURRENT_LIABILITY", parent: "2100" },
  { code: "2200", name: "Long-term Liabilities", type: "LIABILITY", subType: "LONG_TERM_LIABILITY", parent: "2000" },
  { code: "2210", name: "Bank Loans", type: "LIABILITY", subType: "LONG_TERM_LIABILITY", parent: "2200" },
  { code: "2220", name: "Loans from Directors", type: "LIABILITY", subType: "LONG_TERM_LIABILITY", parent: "2200" },
  { code: "3000", name: "Equity", type: "EQUITY" },
  { code: "3100", name: "Owner's Capital", type: "EQUITY", subType: "CAPITAL", parent: "3000" },
  { code: "3200", name: "Retained Earnings", type: "EQUITY", subType: "RETAINED_EARNINGS", parent: "3000" },
  { code: "4000", name: "Income", type: "INCOME" },
  { code: "4100", name: "Sales", type: "INCOME", subType: "OPERATING_INCOME", parent: "4000" },
  { code: "4110", name: "Sales — FTV", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
  { code: "4120", name: "Sales — OR", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
  { code: "4130", name: "Sales — Direct / B2B", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
  { code: "4200", name: "Other Income", type: "INCOME", subType: "OTHER_INCOME", parent: "4000" },
  { code: "4210", name: "Interest Income", type: "INCOME", subType: "OTHER_INCOME", parent: "4200" },
  { code: "4220", name: "Scrap / Misc Sales", type: "INCOME", subType: "OTHER_INCOME", parent: "4200" },
  { code: "5000", name: "Expenses", type: "EXPENSE" },
  { code: "5100", name: "Cost of Goods Sold", type: "EXPENSE", subType: "COGS", parent: "5000" },
  { code: "5200", name: "Operating Expenses", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5000" },
  { code: "5210", name: "Office Rent", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5220", name: "Salaries & Wages", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5230", name: "Marketing Expense", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5240", name: "Travel & Conveyance", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5250", name: "Professional Fees (CA / Legal)", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5260", name: "Utilities (Electricity, Internet)", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5270", name: "Repairs & Maintenance", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5280", name: "Bank Charges", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5290", name: "Office Supplies", type: "EXPENSE", subType: "OPERATING_EXPENSE", parent: "5200" },
  { code: "5300", name: "Other Expenses", type: "EXPENSE", subType: "OTHER_EXPENSE", parent: "5000" },
  { code: "5310", name: "Depreciation", type: "EXPENSE", subType: "OTHER_EXPENSE", parent: "5300" },
  { code: "5320", name: "Interest Expense", type: "EXPENSE", subType: "OTHER_EXPENSE", parent: "5300" },
];

const SERIES_DEFAULTS: Array<{ docType: string; prefix: string; padding: number }> = [
  { docType: "PO", prefix: "PO-", padding: 5 },
  { docType: "GRN", prefix: "GRN-", padding: 5 },
  { docType: "INV", prefix: "INV-", padding: 5 },
  { docType: "JV", prefix: "JV-", padding: 5 },
  { docType: "BT", prefix: "BT-", padding: 5 },
];

/** Seed standard CoA + series for a brand-new company. Every company
 *  uses clean Tally-style codes ("1110", "1130", etc.) — the schema
 *  uses `(companyId, code)` composite uniqueness so the same code in
 *  another company doesn't collide. */
async function seedCompanyForCreate(companyId: string) {
  for (const a of STANDARD_COA) {
    const exists = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId, code: a.code } },
      select: { id: true },
    });
    if (!exists) {
      await prisma.chartOfAccount.create({
        data: { code: a.code, name: a.name, type: a.type, subType: a.subType ?? null, isSystem: true, companyId },
      });
    }
  }
  for (const a of STANDARD_COA) {
    if (!a.parent) continue;
    const parent = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId, code: a.parent } },
      select: { id: true },
    });
    if (parent) {
      await prisma.chartOfAccount.update({
        where: { companyId_code: { companyId, code: a.code } },
        data: { parentId: parent.id },
      });
    }
  }
  for (const s of SERIES_DEFAULTS) {
    const exists = await prisma.series.findUnique({
      where: { companyId_docType: { companyId, docType: s.docType } },
      select: { id: true },
    });
    if (!exists) {
      await prisma.series.create({
        data: { companyId, docType: s.docType, prefix: s.prefix, nextNumber: 1, padding: s.padding },
      });
    }
  }
}

/** Create a new company + seed defaults + switch the active cookie. */
export async function createCompany(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  // Multi-company deferred: refuse unconditionally (defense in depth — the UI
  // is hidden, but the action is still exported). Re-enable via
  // MULTI_COMPANY_ENABLED in src/lib/company.ts.
  if (!MULTI_COMPANY_ENABLED) {
    return { error: "Multi-company is disabled — the app runs as a single company." };
  }
  const legalName = String(fd.get("legalName") ?? "").trim();
  const brandName = String(fd.get("brandName") ?? "").trim() || legalName;
  const state = String(fd.get("state") ?? "").trim();
  const gstin = String(fd.get("gstin") ?? "").trim();
  const address = String(fd.get("address") ?? "").trim() || null;
  const city = String(fd.get("city") ?? "").trim() || null;
  const pincode = String(fd.get("pincode") ?? "").trim() || null;
  const email = String(fd.get("email") ?? "").trim() || null;
  const mobile = String(fd.get("mobile") ?? "").trim() || null;

  if (!legalName) return { error: "Legal name required", fieldErrors: { legalName: "Required" } };
  if (gstin && !state) return { error: "State required when GSTIN is set", fieldErrors: { state: "Required" } };

  // License gate (#136). Creating a 2nd+ company needs the MULTI_COMPANY
  // feature; even with it, seats cap may be hit.
  const seats = await seatsAvailable();
  if (seats.used >= 1 && !(await hasFeature(FEATURES.MULTI_COMPANY))) {
    return { error: "Your current plan only allows 1 company. Upgrade at /settings/license to add more." };
  }
  if (!seats.unlimited && seats.remaining <= 0) {
    return { error: `Seat cap reached (${seats.used}/${seats.cap}). Upgrade your plan to add more companies.` };
  }

  const company = await prisma.company.create({
    data: {
      legalName, brandName, state: state || null, address, city, pincode,
      email, mobile, isActive: true, isPrimary: false, baseCurrency: "INR", fyStartMonth: 4,
    },
  });

  await prisma.userCompany.create({
    data: { userId: me.id, companyId: company.id, role: "OWNER" },
  });

  if (gstin && state) {
    await prisma.companyGSTIN.create({
      data: {
        companyId: company.id, gstin, state,
        registrationType: "REGULAR", isActive: true, isDefault: true,
      },
    });
  }

  await seedCompanyForCreate(company.id);
  await logWrite("Company", company.id, "CREATE", null, { legalName, brandName });

  // Switch the cookie to the new company.
  await setActiveCompanyId({ companyId: company.id, userId: me.id, role: me.role });

  revalidatePath("/companies");
  revalidatePath("/accounting/chart");
  return { ok: true, id: company.id };
}

/** Switch the active-company cookie (called from the topbar dropdown). */
export async function switchActiveCompany(companyId: string): Promise<void> {
  const me = await requireAdmin();
  const r = await setActiveCompanyId({ companyId, userId: me.id, role: me.role });
  if (!("ok" in r) || !r.ok) {
    // No way to surface error from a redirect — fall through and the
    // page just stays on the old company. The switcher in the UI will
    // re-fetch and show the actual active company.
    return;
  }
  await logWrite("Company", companyId, "UPDATE", null, { activeSwitch: true });
  // Revalidate everything — switching company changes every list.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Delete a company — refuses if anything is linked or it's the primary. */
export async function deleteCompany(companyId: string): Promise<Result> {
  await requireAdmin();
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { isPrimary: true, _count: { select: { vendors: true, items: true, customers: true } } },
  });
  if (!c) return { error: "Company not found" };
  if (c.isPrimary) return { error: "Cannot delete the primary company" };
  if (c._count.vendors + c._count.items + c._count.customers > 0) {
    return { error: "Company has operational rows — mark inactive instead." };
  }
  await prisma.company.delete({ where: { id: companyId } });
  await logWrite("Company", companyId, "DELETE", null, null);
  revalidatePath("/companies");
  return { ok: true };
}
