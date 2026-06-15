"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { isValidModel } from "@/lib/models";
import { otherChargeSchema } from "@/lib/validators/otherCharge";
import { getActiveCompanyId } from "@/lib/company";

type Result =
  | { ok: true; id: string; chargeNo: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

/** No-op since #134 — `nextDocNumber()` auto-creates per-company. */
async function ensureNoteSeries(_docType: "DN" | "CN") {
  // intentionally empty
  void _docType;
}

export async function createOtherCharge(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const parsed = otherChargeSchema.safeParse({
    date: String(fd.get("date") ?? ""),
    vendorId: String(fd.get("vendorId") ?? ""),
    direction: String(fd.get("direction") ?? "DEBIT"),
    model: String(fd.get("model") ?? ""),
    reason: String(fd.get("reason") ?? ""),
    taxable: String(fd.get("taxable") ?? ""),
    gstRate: String(fd.get("gstRate") ?? ""),
    notes: String(fd.get("notes") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const date = parseFlexibleDate(parsed.data.date);
  if (!date) return { error: "Invalid date", fieldErrors: { date: "Use a valid date" } };

  if (!(await isValidModel(parsed.data.model))) {
    return { error: "Unknown model", fieldErrors: { model: "Pick a valid model" } };
  }

  const companyId = await getActiveCompanyId();
  const vendor = await prisma.vendor.findFirst({ where: { id: parsed.data.vendorId, companyId }, select: { id: true } });
  if (!vendor) return { error: "Vendor not found", fieldErrors: { vendorId: "Pick a valid vendor" } };

  const gst = Number(((parsed.data.taxable * parsed.data.gstRate) / 100).toFixed(2));
  const total = Number((parsed.data.taxable + gst).toFixed(2));

  const docType = parsed.data.direction === "CREDIT" ? "CN" : "DN";
  await ensureNoteSeries(docType);

  let createdId = "";
  let chargeNo = "";
  try {
    const created = await prisma.$transaction(async (tx) => {
      const no = await nextDocNumber(docType, tx);
      return tx.otherCharge.create({
        data: {
          companyId,
          chargeNo: no,
          date,
          vendorId: parsed.data.vendorId,
          direction: parsed.data.direction,
          model: parsed.data.model,
          reason: parsed.data.reason,
          taxable: parsed.data.taxable,
          gstRate: parsed.data.gstRate,
          gst,
          total,
          notes: parsed.data.notes ?? null,
          createdBy: me.id,
        },
      });
    });
    createdId = created.id;
    chargeNo = created.chargeNo;
  } catch {
    return { error: "Failed to record note" };
  }

  await logWrite("OtherCharge", createdId, "CREATE", null, { chargeNo, direction: parsed.data.direction, model: parsed.data.model, vendorId: parsed.data.vendorId, total });
  revalidatePath("/other-charges");
  revalidatePath("/ledger");
  return { ok: true, id: createdId, chargeNo };
}

export async function deleteOtherCharge(id: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const before = await prisma.otherCharge.findUnique({ where: { id } });
  if (!before) return { error: "Charge not found" };
  await prisma.otherCharge.delete({ where: { id } });
  await logWrite("OtherCharge", id, "DELETE", before, null);
  revalidatePath("/other-charges");
  revalidatePath("/ledger");
  return { ok: true };
}
