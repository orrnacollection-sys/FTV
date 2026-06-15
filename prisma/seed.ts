import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? "ankur").toLowerCase();
  const email = process.env.SEED_ADMIN_EMAIL ?? "ankur.aries@gmail.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ankur@123";

  const passwordHash = await bcrypt.hash(password, 12);

  // canEdit must be true or every mutating action fails requireEditor().
  // It's set on both branches so a re-seed also re-enables an existing admin.
  await prisma.user.upsert({
    where: { username },
    update: { email, passwordHash, role: "ADMIN", canEdit: true },
    create: { username, email, passwordHash, role: "ADMIN", canEdit: true },
  });

  // PO + GRN series moved below — they're now company-scoped (#134) so
  // they need the primary company id which is resolved further down.

  // Canonical business models (codes are fixed; labels/remarks editable via Model Master).
  const models = [
    { code: "FTV", label: "FTV", returnPolicy: "Returns accepted", sortOrder: 1 },
    { code: "OR", label: "OR", returnPolicy: "Own retail", sortOrder: 2 },
    { code: "FTV_NORETURN", label: "FTV-NORETURN", returnPolicy: "No returns", sortOrder: 3 },
  ];
  for (const m of models) {
    await prisma.modelMaster.upsert({
      where: { code: m.code },
      update: { label: m.label, sortOrder: m.sortOrder },
      create: m,
    });
  }

  // Primary company — replaces the hardcoded ORG constant. Idempotent: we
  // look for the existing isPrimary row first; if it exists, we DON'T blow
  // away admin-edited fields (so re-seeding after edits is safe).
  const existingPrimary = await prisma.company.findFirst({
    where: { isPrimary: true },
    select: { id: true },
  });
  let primaryCompanyId: string;
  if (existingPrimary) {
    primaryCompanyId = existingPrimary.id;
  } else {
    const created = await prisma.company.create({
      data: {
        legalName: "Adwitiya Global",
        brandName: "Adwitiya",
        address: "Surajpur, Greater Noida, Gautam Buddh Nagar",
        city: "Greater Noida",
        state: "Uttar Pradesh",
        pincode: "201310",
        country: "India",
        baseCurrency: "INR",
        fyStartMonth: 4,
        isPrimary: true,
        isActive: true,
      },
    });
    primaryCompanyId = created.id;
  }

  // Default GSTIN — the legacy ORG.gst value. Same idempotent pattern.
  const defaultGstin = "09AJLKHJK1CCF";
  let gstinRecord = await prisma.companyGSTIN.findUnique({
    where: { gstin: defaultGstin },
  });
  if (!gstinRecord) {
    gstinRecord = await prisma.companyGSTIN.create({
      data: {
        companyId: primaryCompanyId,
        gstin: defaultGstin,
        state: "Uttar Pradesh",
        registrationType: "REGULAR",
        isActive: true,
        isDefault: true,
      },
    });
  }

  // PPOB Place under the GSTIN. Only create if the GSTIN has no places at
  // all — admin edits in /settings/company-profile are preserved.
  const existingPlaces = await prisma.companyGSTINPlace.count({
    where: { gstinId: gstinRecord.id },
  });
  if (existingPlaces === 0) {
    await prisma.companyGSTINPlace.create({
      data: {
        gstinId: gstinRecord.id,
        nickname: "Adwitiya HQ (Uttar Pradesh)",
        placeType: "PPOB",
        address: "Surajpur, Greater Noida, Gautam Buddh Nagar",
        city: "Greater Noida",
        pincode: "201310",
        isActive: true,
      },
    });
  }

  // Tax component taxonomy — Indian GST law defines these. Seed once;
  // admins enable/disable via /tax/components but never invent new codes.
  // Idempotent: rows are upserted by `code`.
  const components = [
    // Forward GST (seller collects)
    { code: "CGST",  name: "Central GST",          family: "GST",  chargeType: "FORWARD", scope: "INTRA_STATE", slabFraction: 0.5, sortOrder: 10 },
    { code: "SGST",  name: "State GST",            family: "GST",  chargeType: "FORWARD", scope: "INTRA_STATE", slabFraction: 0.5, sortOrder: 20 },
    { code: "UTGST", name: "Union Territory GST",  family: "GST",  chargeType: "FORWARD", scope: "INTRA_UT",    slabFraction: 0.5, sortOrder: 30 },
    { code: "IGST",  name: "Integrated GST",       family: "GST",  chargeType: "FORWARD", scope: "INTER_STATE", slabFraction: 1.0, sortOrder: 40 },
    // Compensation cess (on top of GST for luxury/sin goods)
    { code: "CESS",  name: "Compensation Cess",    family: "CESS", chargeType: "FORWARD", scope: "ANY",         slabFraction: 0.0, sortOrder: 50 },
    // Reverse charge variants (buyer pays GST on specific HSNs)
    { code: "CGST_RCM",  name: "CGST — Reverse Charge",  family: "GST", chargeType: "REVERSE", scope: "INTRA_STATE", slabFraction: 0.5, sortOrder: 60 },
    { code: "SGST_RCM",  name: "SGST — Reverse Charge",  family: "GST", chargeType: "REVERSE", scope: "INTRA_STATE", slabFraction: 0.5, sortOrder: 70 },
    { code: "UTGST_RCM", name: "UTGST — Reverse Charge", family: "GST", chargeType: "REVERSE", scope: "INTRA_UT",    slabFraction: 0.5, sortOrder: 80 },
    { code: "IGST_RCM",  name: "IGST — Reverse Charge",  family: "GST", chargeType: "REVERSE", scope: "INTER_STATE", slabFraction: 1.0, sortOrder: 90 },
    // Govt buyer TDS (under GST, not income-tax) — 1% CGST + 1% SGST, or 2% IGST
    { code: "CGST_TDS", name: "CGST — TDS (Govt buyer)", family: "TDS", chargeType: "FORWARD", scope: "INTRA_STATE", slabFraction: 0.0, sortOrder: 100 },
    { code: "SGST_TDS", name: "SGST — TDS (Govt buyer)", family: "TDS", chargeType: "FORWARD", scope: "INTRA_STATE", slabFraction: 0.0, sortOrder: 110 },
    { code: "IGST_TDS", name: "IGST — TDS (Govt buyer)", family: "TDS", chargeType: "FORWARD", scope: "INTER_STATE", slabFraction: 0.0, sortOrder: 120 },
    // E-commerce operator TCS (1% on net sales)
    { code: "TCS", name: "TCS — E-commerce", family: "TCS", chargeType: "FORWARD", scope: "ANY", slabFraction: 0.0, sortOrder: 130 },
  ];
  for (const c of components) {
    await prisma.taxComponent.upsert({
      where: { code: c.code },
      update: { name: c.name, family: c.family, chargeType: c.chargeType, scope: c.scope, slabFraction: c.slabFraction, sortOrder: c.sortOrder },
      create: c,
    });
  }

  // Standard Chart of Accounts — Tally-style 4-digit codes. Seeded once,
  // admin can rename / disable but the script never overwrites manual edits
  // (upsert on code with update={} = no-op on re-run).
  const standardCoA: Array<{
    code: string;
    name: string;
    type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";
    subType?: string;
    parent?: string;
  }> = [
    // ─── Assets ────────────────────────────────────────────────────────────
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
    // ─── Liabilities ───────────────────────────────────────────────────────
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
    // ─── Equity ────────────────────────────────────────────────────────────
    { code: "3000", name: "Equity", type: "EQUITY" },
    { code: "3100", name: "Owner's Capital", type: "EQUITY", subType: "CAPITAL", parent: "3000" },
    { code: "3200", name: "Retained Earnings", type: "EQUITY", subType: "RETAINED_EARNINGS", parent: "3000" },
    // ─── Income ────────────────────────────────────────────────────────────
    { code: "4000", name: "Income", type: "INCOME" },
    { code: "4100", name: "Sales", type: "INCOME", subType: "OPERATING_INCOME", parent: "4000" },
    { code: "4110", name: "Sales — FTV", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
    { code: "4120", name: "Sales — OR", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
    { code: "4130", name: "Sales — Direct / B2B", type: "INCOME", subType: "OPERATING_INCOME", parent: "4100" },
    { code: "4200", name: "Other Income", type: "INCOME", subType: "OTHER_INCOME", parent: "4000" },
    { code: "4210", name: "Interest Income", type: "INCOME", subType: "OTHER_INCOME", parent: "4200" },
    { code: "4220", name: "Scrap / Misc Sales", type: "INCOME", subType: "OTHER_INCOME", parent: "4200" },
    // ─── Expenses ──────────────────────────────────────────────────────────
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

  // Two-pass insert so children can resolve their parent FK by code.
  // CoA is per-company (composite unique on companyId_code), so the seed
  // wires the primary company's books here.
  for (const a of standardCoA) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: primaryCompanyId, code: a.code } },
      update: {},
      create: {
        code: a.code,
        name: a.name,
        type: a.type,
        subType: a.subType ?? null,
        isSystem: true,
        companyId: primaryCompanyId,
      },
    });
  }
  for (const a of standardCoA) {
    if (!a.parent) continue;
    const parent = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId: primaryCompanyId, code: a.parent } },
      select: { id: true },
    });
    if (parent) {
      await prisma.chartOfAccount.update({
        where: { companyId_code: { companyId: primaryCompanyId, code: a.code } },
        data: { parentId: parent.id },
      });
    }
  }

  // Per-company series rows (#134). Each docType becomes a (companyId, docType)
  // composite-unique row; we upsert all of them for the primary company here.
  const seriesDefaults: Array<{ docType: string; prefix: string; padding: number }> = [
    { docType: "PO", prefix: "PO-", padding: 5 },
    { docType: "GRN", prefix: "GRN-", padding: 5 },
    { docType: "JV", prefix: "JV-", padding: 5 },
    { docType: "BT", prefix: "BT-", padding: 5 },
    { docType: "INV", prefix: "INV-", padding: 5 },
    { docType: "OPENING", prefix: "OPS", padding: 3 },
  ];
  for (const s of seriesDefaults) {
    await prisma.series.upsert({
      where: { companyId_docType: { companyId: primaryCompanyId, docType: s.docType } },
      update: {},
      create: { companyId: primaryCompanyId, docType: s.docType, prefix: s.prefix, nextNumber: 1, padding: s.padding },
    });
  }

  console.log(`Seeded admin: ${username} + ${models.length} models + ${components.length} tax components + primary Company + ${standardCoA.length} CoA accounts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
