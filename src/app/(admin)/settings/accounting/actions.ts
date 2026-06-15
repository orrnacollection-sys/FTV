"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveCompanyId } from "@/lib/company";
import { logWrite } from "@/lib/audit";

const MODES = ["AUTO", "MANUAL", "NONE"];

/** Save the company's ledger-coding mode and (for AUTO) the LEDGER series. */
export async function saveLedgerCoding(input: {
  mode: string;
  prefix: string;
  padding: number;
  nextNumber: number;
}): Promise<{ ok: true } | { ok?: false; error: string }> {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const mode = MODES.includes(input.mode) ? input.mode : "AUTO";

  await prisma.company.update({ where: { id: companyId }, data: { ledgerCodeMode: mode } });

  if (mode === "AUTO") {
    const prefix = (input.prefix ?? "LED-").trim() || "LED-";
    const padding = Math.min(8, Math.max(1, Math.floor(input.padding) || 4));
    const nextNumber = Math.max(1, Math.floor(input.nextNumber) || 1);
    await prisma.series.upsert({
      where: { companyId_docType: { companyId, docType: "LEDGER" } },
      create: { companyId, docType: "LEDGER", prefix, padding, nextNumber },
      update: { prefix, padding, nextNumber },
    });
  }

  await logWrite("Company", companyId, "UPDATE", null, { ledgerCodeMode: mode });
  revalidatePath("/settings/accounting");
  revalidatePath("/accounting/chart/new");
  return { ok: true };
}
