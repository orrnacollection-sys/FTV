"use server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import {
  parseGSTR2BJson,
  parseGSTR2BCsv,
  findItcMatches,
  applyItcMatches,
} from "@/lib/gst/itc";
import type { Parsed2BLine } from "@/lib/gst/itc";

type Result = { ok: true; id?: string } | { ok?: undefined; error: string };

/** Import a GSTR-2B file. Pass either:
 *   - kind="json" + the portal JSON text (period + GSTIN come from payload)
 *   - kind="csv"  + tabular text + explicit period + filingGstin */
export async function importGSTR2B(input: {
  kind: "json" | "csv";
  text: string;
  filingGstin?: string;
  period?: string;
  dedupeKey?: string;
}): Promise<
  | { ok: true; importBatchId: string; period: string; filingGstin: string; imported: number; errors: string[] }
  | { ok: false; error: string }
> {
  const me = await requireAdmin();

  let filingGstin = input.filingGstin ?? "";
  let period = input.period ?? "";
  let lines: Parsed2BLine[] = [];
  const errors: string[] = [];

  try {
    if (input.kind === "json") {
      const parsed = parseGSTR2BJson(input.text);
      filingGstin = parsed.filingGstin;
      period = parsed.period;
      lines = parsed.lines;
    } else {
      if (!filingGstin || !/^\d{4}-\d{2}$/.test(period)) {
        return { ok: false, error: "CSV import needs filingGstin + period (YYYY-MM)" };
      }
      const r = parseGSTR2BCsv(input.text);
      lines = r.lines;
      errors.push(...r.errors);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parse failed" };
  }

  if (lines.length === 0) return { ok: false, error: errors[0] ?? "No lines parsed" };

  // Validate the GSTIN matches an active CompanyGSTIN.
  const gstinRow = await prisma.companyGSTIN.findUnique({
    where: { gstin: filingGstin },
    select: { isActive: true },
  });
  if (!gstinRow || !gstinRow.isActive) {
    return { ok: false, error: `Unknown / inactive filing GSTIN ${filingGstin}` };
  }

  const importBatchId = input.dedupeKey ?? randomUUID();
  let imported = 0;
  for (const ln of lines) {
    if (!ln.vendorGstin || !ln.invoiceNo) {
      errors.push(`Skipped line: missing GSTIN or invoice no`);
      continue;
    }
    await prisma.gSTR2BLine.create({
      data: {
        importBatchId,
        filingGstin,
        period,
        vendorGstin: ln.vendorGstin,
        vendorName: ln.vendorName,
        invoiceNo: ln.invoiceNo,
        invoiceDate: ln.invoiceDate,
        invoiceType: ln.invoiceType,
        invoiceValue: ln.invoiceValue,
        taxableValue: ln.taxableValue,
        cgst: ln.cgst,
        sgst: ln.sgst,
        igst: ln.igst,
        cess: ln.cess,
        placeOfSupply: ln.placeOfSupply,
        reverseCharge: ln.reverseCharge,
        importedBy: me.id,
      },
    });
    imported++;
  }

  await logWrite("GSTR2BLine", importBatchId, "CREATE", null, {
    filingGstin, period, imported,
  });

  revalidatePath("/gst/itc-reconciliation");
  return { ok: true, importBatchId, period, filingGstin, imported, errors };
}

export async function deleteItcBatch(importBatchId: string): Promise<Result> {
  await requireAdmin();
  const lines = await prisma.gSTR2BLine.findMany({
    where: { importBatchId },
    include: { matchedGrn: { select: { id: true } } },
  });
  if (lines.length === 0) return { error: "Batch not found" };

  // Unhook GRN side first.
  for (const l of lines) {
    if (l.matchedGrn) {
      await prisma.gRN.update({
        where: { id: l.matchedGrn.id },
        data: { matchedItc2bLineId: null },
      });
    }
  }
  await prisma.gSTR2BLine.deleteMany({ where: { importBatchId } });
  await logWrite("GSTR2BLine", importBatchId, "DELETE", { lineCount: lines.length }, null);
  revalidatePath("/gst/itc-reconciliation");
  return { ok: true };
}

export async function autoMatchItc(input: { filingGstin: string; period: string }): Promise<
  { ok: true; proposed: number; matched: number; errors: string[] } | { ok: false; error: string }
> {
  const me = await requireAdmin();
  const r = await findItcMatches({ filingGstin: input.filingGstin, period: input.period });
  const a = await applyItcMatches(r.proposals, me.id);
  revalidatePath("/gst/itc-reconciliation");
  return { ok: true, proposed: r.proposalCount, matched: a.matched, errors: a.errors };
}

export async function matchItcLine(input: { lineId: string; grnId: string }): Promise<Result> {
  const me = await requireAdmin();
  const r = await applyItcMatches([{ lineId: input.lineId, grnId: input.grnId, score: 0, reason: "manual" }], me.id);
  if (r.matched === 0) return { error: r.errors[0] ?? "Match failed" };
  revalidatePath("/gst/itc-reconciliation");
  return { ok: true };
}

export async function unmatchItcLine(lineId: string): Promise<Result> {
  await requireAdmin();
  await prisma.$transaction(async (tx) => {
    const grn = await tx.gRN.findFirst({
      where: { matchedItc2bLineId: lineId },
      select: { id: true },
    });
    await tx.gSTR2BLine.update({
      where: { id: lineId },
      data: { matchStatus: "UNMATCHED", matchedAt: null, matchedBy: null },
    });
    if (grn) {
      await tx.gRN.update({ where: { id: grn.id }, data: { matchedItc2bLineId: null } });
    }
  });
  revalidatePath("/gst/itc-reconciliation");
  return { ok: true };
}

export async function ignoreItcLine(lineId: string): Promise<Result> {
  await requireAdmin();
  await prisma.$transaction(async (tx) => {
    const grn = await tx.gRN.findFirst({
      where: { matchedItc2bLineId: lineId },
      select: { id: true },
    });
    if (grn) {
      await tx.gRN.update({ where: { id: grn.id }, data: { matchedItc2bLineId: null } });
    }
    await tx.gSTR2BLine.update({
      where: { id: lineId },
      data: { matchStatus: "IGNORED", matchedAt: null, matchedBy: null },
    });
  });
  revalidatePath("/gst/itc-reconciliation");
  return { ok: true };
}
