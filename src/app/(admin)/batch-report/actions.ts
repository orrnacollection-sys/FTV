"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, getCurrentUser } from "@/lib/rbac";
import { parseFlexibleDate, toDisplayDate } from "@/lib/date";
import { logWrite } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { sanitizeCell } from "@/lib/csv";
import { buildBatchSkuReport } from "@/lib/batch-report";
import { getActiveCompanyId } from "@/lib/company";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** Update a batch's (GRN's) review date, remarks, and/or validity (expiry). */
export async function updateBatch(fd: FormData): Promise<Result> {
  await requireAdmin();
  const grnId = String(fd.get("grnId") ?? "");
  if (!grnId) return { error: "Batch not specified" };

  const reviewRaw = String(fd.get("reviewDate") ?? "").trim();
  const expiryRaw = String(fd.get("expiry") ?? "").trim();
  const remarks = String(fd.get("remarks") ?? "").trim();

  const reviewDate = reviewRaw ? parseFlexibleDate(reviewRaw) : null;
  if (reviewRaw && !reviewDate) return { error: "Invalid review date", fieldErrors: { reviewDate: "Use a valid date" } };

  const expiry = expiryRaw ? parseFlexibleDate(expiryRaw) : null;
  if (expiryRaw && !expiry) return { error: "Invalid validity date", fieldErrors: { expiry: "Use a valid date" } };

  const before = await prisma.gRN.findUnique({ where: { id: grnId }, select: { id: true } });
  if (!before) return { error: "Batch not found" };

  await prisma.gRN.update({
    where: { id: grnId },
    data: { reviewDate, batchRemarks: remarks || null },
  });
  // Extend Validity → update every line's batch expiry for this GRN.
  if (expiry) {
    await prisma.gRNItem.updateMany({ where: { grnId }, data: { batchExpDate: expiry } });
  }

  await logWrite("GRN", grnId, "UPDATE", null, { batch: { reviewDate, remarks, expiry } });
  revalidatePath("/batch-report");
  revalidatePath(`/batch-report/${grnId}`);
  return { ok: true };
}

type ImportResult = { updated: number; errors: string[] };

/** Bulk-import batch remarks (and optional review date) by Batch No (= GRN No). */
export async function importBatchRemarks(rows: Record<string, string>[]): Promise<ImportResult> {
  await requireAdmin();
  if (rows.length === 0) return { updated: 0, errors: ["No rows"] };

  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
    return "";
  };

  let updated = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const batchNo = pick(r, "Batch No", "BatchNo", "batchNo", "Batch No.", "GRN", "grnNo").trim();
    if (!batchNo) { errors.push(`Row ${i + 1}: Batch No required`); continue; }
    const remarks = pick(r, "Remarks", "remarks").trim();
    const reviewRaw = pick(r, "Review Date", "reviewDate").trim();
    const reviewDate = reviewRaw ? parseFlexibleDate(reviewRaw) : null;
    if (reviewRaw && !reviewDate) { errors.push(`Row ${i + 1}: invalid review date`); continue; }

    const grn = await prisma.gRN.findUnique({ where: { grnNo: batchNo }, select: { id: true } });
    if (!grn) { errors.push(`Row ${i + 1}: batch "${batchNo}" not found`); continue; }

    await prisma.gRN.update({
      where: { id: grn.id },
      data: { batchRemarks: remarks || null, ...(reviewDate ? { reviewDate } : {}) },
    });
    updated++;
  }
  if (updated > 0) await logWrite("GRN", "bulk", "UPDATE", null, { batchRemarksImported: updated });
  revalidatePath("/batch-report");
  return { updated, errors };
}

/** Email the SKU-wise batch report (CSV) to the batch's vendor. */
export async function emailBatchReport(grnId: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const grn = await prisma.gRN.findFirst({
    where: { id: grnId, companyId },
    select: { grnNo: true, vendor: { select: { name: true, email: true } } },
  });
  if (!grn) return { error: "Batch not found" };
  if (!grn.vendor.email) return { error: "Vendor has no email on file" };

  const { rows } = await buildBatchSkuReport(companyId, grnId);
  const headers = ["SKU", "Item", "Warehouse", "Model", "Inward", "Sale", "RTO", "Return", "Net", "% Return", "Bal Qty"];
  const esc = (v: unknown) => `"${String(sanitizeCell(v)).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) {
    lines.push([
      r.skuCode, r.itemName, r.warehouse ?? "", r.model ?? "",
      r.inward.toFixed(2), r.sale.toFixed(2), r.rto.toFixed(2), r.ret.toFixed(2),
      r.net.toFixed(2), r.pctReturn.toFixed(1), r.balQty.toFixed(2),
    ].map(esc).join(","));
  }
  const csv = lines.join("\n");
  const me = await getCurrentUser();

  try {
    await sendEmail({
      to: grn.vendor.email,
      cc: me?.email ?? undefined,
      subject: `Batch report — ${grn.grnNo}`,
      text: `Hello ${grn.vendor.name},\n\nAttached is the SKU-wise batch report for ${grn.grnNo} as on ${toDisplayDate(new Date())}.\n\n— Adwitiya Global`,
      attachments: [{ filename: `batch-${grn.grnNo}.csv`, content: Buffer.from(csv, "utf8"), contentType: "text/csv" }],
    });
  } catch {
    return { error: "Email failed (see server logs)" };
  }
  await logWrite("GRN", grnId, "UPDATE", null, { batchReportEmailedTo: grn.vendor.email });
  return { ok: true };
}
