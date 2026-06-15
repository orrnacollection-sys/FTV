"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveCompanyId } from "@/lib/company";
import { logWrite } from "@/lib/audit";
import { nextDocNumber } from "@/lib/series";
import { signedOpening } from "@/lib/accounting";

const TYPES = ["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"];

type Result =
  | { ok: true; id: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** Create a custom ledger account. Code handling follows the company's
 *  `ledgerCodeMode`: AUTO (next from the LEDGER series), MANUAL (typed), or
 *  NONE (name-only). Seeded + auto sub-ledgers are unaffected. */
export async function createLedger(fd: FormData): Promise<Result> {
  await requireAdmin();
  const companyId = await getActiveCompanyId();

  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("type") ?? "").trim();
  const subType = String(fd.get("subType") ?? "").trim() || null;
  const parentId = String(fd.get("parentId") ?? "").trim() || null;
  const openingDrCr = String(fd.get("openingType") ?? "DR").toUpperCase() === "CR" ? "CR" : "DR";
  const openingBalance = signedOpening(type, Number(fd.get("openingBalance") ?? 0) || 0, openingDrCr);
  let code: string | null = String(fd.get("code") ?? "").trim().toUpperCase() || null;

  if (!name) return { error: "Ledger name is required", fieldErrors: { name: "Required" } };
  if (!TYPES.includes(type)) return { error: "Choose a group (Asset / Liability / …)", fieldErrors: { type: "Required" } };

  // Name must be unique within the company (Tally enforces this too).
  const dupName = await prisma.chartOfAccount.findFirst({ where: { companyId, name }, select: { id: true } });
  if (dupName) return { error: `A ledger named "${name}" already exists.`, fieldErrors: { name: "Already exists" } };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { ledgerCodeMode: true } });
  const mode = company?.ledgerCodeMode ?? "AUTO";

  if (mode === "AUTO") {
    code = await nextDocNumber("LEDGER");
  } else if (mode === "MANUAL") {
    if (!code) return { error: "A code is required (Manual coding mode).", fieldErrors: { code: "Required" } };
  } else {
    code = null; // NONE — name-only ledger
  }

  if (code) {
    const dupCode = await prisma.chartOfAccount.findFirst({ where: { companyId, code }, select: { id: true } });
    if (dupCode) return { error: `Code ${code} is already in use.`, fieldErrors: { code: "Already in use" } };
  }

  if (parentId) {
    const parent = await prisma.chartOfAccount.findFirst({ where: { id: parentId, companyId }, select: { id: true } });
    if (!parent) return { error: "Selected parent group not found.", fieldErrors: { parentId: "Invalid" } };
  }

  const created = await prisma.chartOfAccount.create({
    data: { companyId, code, name, type, subType, parentId, openingBalance, isSystem: false, isActive: true },
  });
  await logWrite("ChartOfAccount", created.id, "CREATE", null, { code, name, type, subType });
  revalidatePath("/accounting/chart");
  return { ok: true, id: created.id };
}

/** Edit an existing ledger. Name/group/sub-group/parent/opening/active are
 *  always editable (system accounts can be renamed, just not deleted). The
 *  code can only be changed in MANUAL coding mode and never for system or
 *  auto-linked (Customer/Vendor/Bank) sub-ledgers. */
export async function updateLedger(fd: FormData): Promise<Result> {
  await requireAdmin();
  const companyId = await getActiveCompanyId();

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Missing ledger id" };

  const existing = await prisma.chartOfAccount.findFirst({
    where: { id, companyId },
    select: {
      id: true, code: true, name: true, type: true, subType: true, parentId: true,
      openingBalance: true, isActive: true, isSystem: true,
      customerId: true, vendorId: true, bankAccountId: true,
    },
  });
  if (!existing) return { error: "Ledger not found" };

  const name = String(fd.get("name") ?? "").trim();
  const type = String(fd.get("type") ?? "").trim();
  const subType = String(fd.get("subType") ?? "").trim() || null;
  const parentId = String(fd.get("parentId") ?? "").trim() || null;
  const rawActive = String(fd.get("isActive") ?? "");
  const isActive = rawActive === "on" || rawActive === "true";
  const openingDrCr = String(fd.get("openingType") ?? "DR").toUpperCase() === "CR" ? "CR" : "DR";
  const openingBalance = signedOpening(type, Number(fd.get("openingBalance") ?? 0) || 0, openingDrCr);

  if (!name) return { error: "Ledger name is required", fieldErrors: { name: "Required" } };
  if (!TYPES.includes(type)) return { error: "Choose a group (Asset / Liability / …)", fieldErrors: { type: "Required" } };

  const dupName = await prisma.chartOfAccount.findFirst({
    where: { companyId, name, id: { not: id } },
    select: { id: true },
  });
  if (dupName) return { error: `A ledger named "${name}" already exists.`, fieldErrors: { name: "Already exists" } };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { ledgerCodeMode: true } });
  const mode = company?.ledgerCodeMode ?? "AUTO";
  const isLinked = !!(existing.customerId || existing.vendorId || existing.bankAccountId);
  let code = existing.code;
  if (mode === "MANUAL" && !existing.isSystem && !isLinked) {
    const typed = String(fd.get("code") ?? "").trim().toUpperCase() || null;
    if (typed !== existing.code) {
      if (typed) {
        const dupCode = await prisma.chartOfAccount.findFirst({
          where: { companyId, code: typed, id: { not: id } },
          select: { id: true },
        });
        if (dupCode) return { error: `Code ${typed} is already in use.`, fieldErrors: { code: "Already in use" } };
      }
      code = typed;
    }
  }

  if (parentId) {
    if (parentId === id) return { error: "A ledger can't be its own parent.", fieldErrors: { parentId: "Invalid" } };
    const parent = await prisma.chartOfAccount.findFirst({ where: { id: parentId, companyId }, select: { id: true } });
    if (!parent) return { error: "Selected parent group not found.", fieldErrors: { parentId: "Invalid" } };
  }

  await prisma.chartOfAccount.update({
    where: { id },
    data: { code, name, type, subType, parentId, openingBalance, isActive },
  });
  await logWrite("ChartOfAccount", id, "UPDATE", existing, { code, name, type, subType, parentId, openingBalance, isActive });
  revalidatePath("/accounting/chart");
  revalidatePath("/accounting/ledgers");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  revalidatePath("/accounting/pnl");
  return { ok: true, id };
}
