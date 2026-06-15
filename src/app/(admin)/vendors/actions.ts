"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { vendorSchema } from "@/lib/validators/vendor";
import { requireEditor } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { ensureVendorCoA, signedOpening, setSubLedgerOpening } from "@/lib/accounting";
import { getActiveCompanyId } from "@/lib/company";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const INVITE_EXPIRY_DAYS = 7;

const MAX_CSV_ROWS = 5000;

type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function rawToObj(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) o[k] = String(v);
  return o;
}

/** Write the form's opening balance (amount + Dr/Cr) to the vendor's Sundry
 *  Creditors sub-ledger. Vendor accounts are credit-natured (LIABILITY). */
async function applyVendorOpening(fd: FormData, accountId: string) {
  const amt = Number(fd.get("openingBalance") ?? 0) || 0;
  const drCr = String(fd.get("openingType") ?? "CR").toUpperCase() === "DR" ? "DR" : "CR";
  await setSubLedgerOpening(accountId, signedOpening("LIABILITY", amt, drCr));
}

export async function createVendor(fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = vendorSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  // Admin-created vendors require approval too — land in PENDING regardless of
  // the form's status default. Admin is taken straight to the review screen.
  // Vendor code is now whatever the admin typed (may be null).
  let createdId: string | null = null;
  try {
    const companyId = await getActiveCompanyId();
    const created = await prisma.vendor.create({
      data: { ...parsed.data, status: "PENDING", appliedAt: new Date(), companyId },
    });
    createdId = created.id;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "A vendor with this email or code already exists" };
    }
    return { ok: false, error: "Failed to create vendor" };
  }
  if (createdId) {
    await logWrite("Vendor", createdId, "CREATE", null, { ...parsed.data, status: "PENDING" });
    // #125 — paired CoA sub-ledger under Sundry Creditors. Failure logged
    // but doesn't roll back vendor create.
    const coaRes = await ensureVendorCoA(createdId);
    if ("error" in coaRes) {
      console.error(`[vendor.create] CoA auto-create failed: ${coaRes.error}`);
    } else {
      await applyVendorOpening(fd, coaRes.accountId);
    }
  }
  revalidatePath("/vendors");
  redirect(createdId ? `/vendors/${createdId}/review` : "/vendors");
}

export async function updateVendor(id: string, fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = vendorSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  // Vendor code is manual — whatever the admin typed (or null) is stored.
  const before = await prisma.vendor.findUnique({ where: { id }, select: { status: true } });
  if (!before) return { ok: false, error: "Vendor not found" };

  try {
    await prisma.$transaction(async (tx) => {
      // Block silent PENDING→ACTIVE via edit (approval must use the review
      // screen); other status transitions like ACTIVE↔INACTIVE are still allowed.
      const finalStatus =
        before.status === "PENDING" && parsed.data.status === "ACTIVE" ? "PENDING" : parsed.data.status;
      await tx.vendor.update({ where: { id }, data: { ...parsed.data, status: finalStatus } });
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "A vendor with this email or code already exists" };
    }
    return { ok: false, error: "Failed to update vendor" };
  }
  await logWrite("Vendor", id, "UPDATE", before, parsed.data);
  // Keep the opening balance on the vendor's sub-ledger in sync.
  const coaRes = await ensureVendorCoA(id);
  if (!("error" in coaRes)) await applyVendorOpening(fd, coaRes.accountId);
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
  redirect("/vendors");
}

export async function deleteVendor(id: string): Promise<void> {
  await requireEditor();
  const before = await prisma.vendor.findUnique({ where: { id } });
  await prisma.vendor.delete({ where: { id } });
  if (before) await logWrite("Vendor", id, "DELETE", before, null);
  revalidatePath("/vendors");
}

export async function bulkImportVendors(rows: Record<string, string>[], confirmOverwrite = false) {
  await requireEditor();
  if (rows.length > MAX_CSV_ROWS) {
    return { created: 0, updated: 0, errors: [`Batch too large — max ${MAX_CSV_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  // Overwrite guard: rows are matched to existing vendors by email — count how
  // many would update an existing vendor.
  const incomingEmails = [...new Set(rows.map((r) => (r.email ?? r.Email ?? "").trim().toLowerCase()).filter(Boolean))];
  const overwriteCount = incomingEmails.length
    ? await prisma.vendor.count({ where: { companyId, email: { in: incomingEmails } } })
    : 0;
  if (overwriteCount > 0 && !confirmOverwrite) {
    return { created: 0, updated: 0, errors: [], needsConfirm: true, overwriteCount };
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const data = {
      name: r.name ?? r.Name ?? "",
      code: r.code ?? r.Code ?? r["Vendor Code"] ?? "",
      email: r.email ?? r.Email ?? "",
      whatsapp: r.whatsapp ?? r.Whatsapp ?? r.WhatsApp ?? "",
      gst: r.gst ?? r.GST ?? "",
      gstRegType: (r.gstRegType ?? r["GST Reg Type"] ?? r["Registration Type"] ?? "").toUpperCase() || "UNREGISTERED",
      pan: r.pan ?? r.PAN ?? "",
      ifsc: r.ifsc ?? r.IFSC ?? "",
      bankName: r.bankName ?? r["Bank Name"] ?? "",
      accountNo: r.accountNo ?? r["Account No"] ?? r.account ?? "",
      address: r.address ?? r.Address ?? "",
      city: r.city ?? r.City ?? "",
      state: r.state ?? r.State ?? "",
      pincode: r.pincode ?? r.Pincode ?? r.PIN ?? r.pin ?? "",
      country: r.country ?? r.Country ?? "",
      status: (r.status ?? r.Status ?? "ACTIVE").toUpperCase(),
    };
    const parsed = vendorSchema.safeParse(data);
    if (!parsed.success) {
      errors.push(`Row "${data.name || "?"}": ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    try {
      // Match existing by email (the natural import key). Generate code on create.
      const existing = parsed.data.email
        ? await prisma.vendor.findUnique({ where: { email: parsed.data.email } })
        : null;
      if (existing) {
        // Preserve the existing vendor's status on update — don't silently
        // demote an ACTIVE vendor back to PENDING from a CSV that omits status.
        // Code is whatever the CSV provided (may be empty → keep existing).
        await prisma.vendor.update({
          where: { id: existing.id },
          data: { ...parsed.data, code: parsed.data.code ?? existing.code, status: existing.status },
        });
        updated++;
      } else {
        // Newly imported vendors also require approval — land in PENDING.
        const companyId = await getActiveCompanyId();
        await prisma.vendor.create({
          data: { ...parsed.data, status: "PENDING", appliedAt: new Date(), companyId },
        });
        created++;
      }
    } catch {
      errors.push(`Row "${data.name}": save failed`);
    }
  }
  revalidatePath("/vendors");
  return { created, updated, errors };
}

// ── Application approval / rejection ─────────────────────────────────────────

type ApprovalResult = { ok: true; inviteUrl?: string } | { ok?: undefined; error: string };

export async function approveApplication(
  vendorId: string,
  reviewNotes?: string,
): Promise<ApprovalResult> {
  const me = await requireEditor();

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return { error: "Vendor not found" };
  if (vendor.status !== "PENDING") return { error: "Application is not pending" };
  if (!vendor.email) return { error: "No applicant email on file" };

  // Block if a user already exists for this email (shouldn't happen for first-time apply, but guards re-runs).
  const existingUser = await prisma.user.findUnique({ where: { email: vendor.email } });
  if (existingUser) return { error: "A user already exists for this email" };

  const token = crypto.randomBytes(32).toString("base64url");

  // Atomic claim: only succeeds if still PENDING. Prevents two concurrent
  // approvers both creating an invite for the same applicant. The vendor's
  // code (manual now) stays as-is; admin should have set it on the form.
  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.vendor.updateMany({
        where: { id: vendorId, status: "PENDING" },
        data: {
          status: "ACTIVE",
          reviewedAt: new Date(),
          reviewedById: me.id,
          reviewNotes: reviewNotes ?? null,
        },
      });
      if (claim.count !== 1) throw new Error("ALREADY_HANDLED");
      await tx.vendorInvite.create({
        data: {
          token,
          email: vendor.email!,
          role: "VENDOR_ADMIN",
          vendorId,
          invitedById: me.id,
          expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_HANDLED") {
      return { error: "Application has already been reviewed" };
    }
    return { error: "Approval failed" };
  }

  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${token}`;
  await logWrite("Vendor", vendorId, "UPDATE", { status: "PENDING" }, { status: "ACTIVE", inviteEmailedTo: vendor.email });

  try {
    await sendEmail({
      to: vendor.email,
      subject: `Welcome to Adwitiya — set up your account`,
      text: `Hello ${vendor.contactName ?? vendor.name},\n\nYour vendor application has been approved.\n\nSet up your account here (link expires in ${INVITE_EXPIRY_DAYS} days):\n${inviteUrl}\n\nReference: ${vendor.code}\n\n— Adwitiya Global`,
    });
  } catch (e) {
    console.error("[approveApplication] invite email failed:", e);
  }

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath(`/vendors/${vendorId}/review`);
  return { ok: true, inviteUrl };
}

/** Approve a vendor WITHOUT sending a portal invite — just flip PENDING →
 *  ACTIVE. Use for vendors who won't use the portal, have no email, or whose
 *  email already belongs to a user. No VendorInvite / email is created, so none
 *  of the email/user-exists checks apply. */
export async function approveWithoutInvite(vendorId: string, reviewNotes?: string): Promise<ApprovalResult> {
  const me = await requireEditor();
  const claim = await prisma.vendor.updateMany({
    where: { id: vendorId, status: "PENDING" },
    data: {
      status: "ACTIVE",
      reviewedAt: new Date(),
      reviewedById: me.id,
      reviewNotes: reviewNotes ?? null,
    },
  });
  if (claim.count !== 1) return { error: "Application has already been reviewed" };

  await logWrite("Vendor", vendorId, "UPDATE", { status: "PENDING" }, { status: "ACTIVE", invited: false });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath(`/vendors/${vendorId}/review`);
  return { ok: true };
}

export async function rejectApplication(vendorId: string, reviewNotes?: string): Promise<ApprovalResult> {
  const me = await requireEditor();
  const claim = await prisma.vendor.updateMany({
    where: { id: vendorId, status: "PENDING" },
    data: {
      status: "INACTIVE",
      reviewedAt: new Date(),
      reviewedById: me.id,
      reviewNotes: reviewNotes ?? null,
    },
  });
  if (claim.count !== 1) return { error: "Application has already been reviewed" };

  await logWrite("Vendor", vendorId, "UPDATE", { status: "PENDING" }, { status: "INACTIVE", reviewNotes });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}/review`);
  return { ok: true };
}
