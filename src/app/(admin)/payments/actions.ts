"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { paymentStatusSchema } from "@/lib/validators/payment";
import { parseFlexibleDate } from "@/lib/date";
import { logWrite } from "@/lib/audit";
import { postPaymentJournal, reverseAutoJournal } from "@/lib/accounting";
import { getActiveCompanyId } from "@/lib/company";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

export async function upsertPaymentStatus(fd: FormData): Promise<Result> {
  const me = await requireAdmin();
  const parsed = paymentStatusSchema.safeParse({
    vendorId: String(fd.get("vendorId") ?? ""),
    month: String(fd.get("month") ?? ""),
    model: String(fd.get("model") ?? ""),
    amountPaid: String(fd.get("amountPaid") ?? "0"),
    status: String(fd.get("status") ?? "PENDING"),
    utr: String(fd.get("utr") ?? ""),
    remarks: String(fd.get("remarks") ?? ""),
    paidOn: String(fd.get("paidOn") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const paidOn = parsed.data.paidOn ? parseFlexibleDate(parsed.data.paidOn) : null;
  if (parsed.data.paidOn && !paidOn) return { error: "Invalid paid date" };

  const before = await prisma.payment.findUnique({
    where: {
      vendorId_month_model: {
        vendorId: parsed.data.vendorId,
        month: parsed.data.month,
        model: parsed.data.model,
      },
    },
  });

  const companyId = await getActiveCompanyId();
  const data = {
    companyId,
    vendorId: parsed.data.vendorId,
    month: parsed.data.month,
    model: parsed.data.model,
    amountPaid: parsed.data.amountPaid,
    status: parsed.data.status,
    utr: parsed.data.utr ?? null,
    remarks: parsed.data.remarks ?? null,
    paidOn,
    createdBy: me.id,
  };

  const after = await prisma.payment.upsert({
    where: {
      vendorId_month_model: {
        vendorId: parsed.data.vendorId,
        month: parsed.data.month,
        model: parsed.data.model,
      },
    },
    create: data,
    update: {
      amountPaid: data.amountPaid,
      status: data.status,
      utr: data.utr,
      remarks: data.remarks,
      paidOn: data.paidOn,
    },
  });
  await logWrite("Payment", after.id, before ? "UPDATE" : "CREATE", before, after);
  // Auto-post: reverse any prior JV (status change can flip pending→paid
  // or vice versa) then re-post if the payment is now non-PENDING.
  await reverseAutoJournal("AUTO_PAYMENT", after.id);
  const jvRes = await postPaymentJournal(after.id);
  if ("error" in jvRes) console.error(`[upsertPaymentStatus] postPaymentJournal failed for ${after.id}: ${jvRes.error}`);
  revalidatePath("/payments");
  revalidatePath("/ledger");
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/trial-balance");
  revalidatePath("/accounting/balance-sheet");
  return { ok: true };
}
