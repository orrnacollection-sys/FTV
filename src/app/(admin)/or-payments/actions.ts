"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate } from "@/lib/date";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { orPaymentSchema } from "@/lib/validators/orPayment";
import { getActiveCompanyId } from "@/lib/company";

type Result =
  | { ok: true; id: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

async function ensureOrPaySeries() {
  // No-op since #134 — `nextDocNumber()` auto-creates per-company.
}

export async function createOrPayment(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const parsed = orPaymentSchema.safeParse({
    vendorId: String(fd.get("vendorId") ?? ""),
    date: String(fd.get("date") ?? ""),
    amount: String(fd.get("amount") ?? ""),
    reference: String(fd.get("reference") ?? ""),
    particulars: String(fd.get("particulars") ?? ""),
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

  const companyId = await getActiveCompanyId();
  const vendor = await prisma.vendor.findFirst({ where: { id: parsed.data.vendorId, companyId }, select: { id: true } });
  if (!vendor) return { error: "Vendor not found", fieldErrors: { vendorId: "Pick a valid vendor" } };

  await ensureOrPaySeries();
  let createdId = "";
  try {
    const created = await prisma.$transaction(async (tx) => {
      const voucherNo = await nextDocNumber("ORP", tx);
      return tx.orPayment.create({
        data: {
          companyId,
          voucherNo,
          vendorId: parsed.data.vendorId,
          date,
          amount: parsed.data.amount,
          reference: parsed.data.reference ?? null,
          particulars: parsed.data.particulars ?? null,
          createdBy: me.id,
        },
      });
    });
    createdId = created.id;
  } catch {
    return { error: "Failed to record payment" };
  }

  await logWrite("OrPayment", createdId, "CREATE", null, { vendorId: parsed.data.vendorId, amount: parsed.data.amount });
  revalidatePath("/or-payments");
  revalidatePath("/ledger");
  return { ok: true, id: createdId };
}

export async function deleteOrPayment(id: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const before = await prisma.orPayment.findUnique({ where: { id } });
  if (!before) return { error: "Payment not found" };
  await prisma.orPayment.delete({ where: { id } });
  await logWrite("OrPayment", id, "DELETE", before, null);
  revalidatePath("/or-payments");
  revalidatePath("/ledger");
  return { ok: true };
}
