"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/rbac";
import { isAdminRole } from "@/lib/constants";
import { inviteSchema } from "@/lib/validators/user";
import { logWrite } from "@/lib/audit";
import { env } from "@/lib/env";

type Result =
  | { ok: true; token?: string; inviteUrl?: string }
  | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

const INVITE_EXPIRY_DAYS = 7;

function inviteUrl(token: string) {
  return `${env.NEXT_PUBLIC_APP_URL}/invite/${token}`;
}

export async function createInvite(fd: FormData): Promise<Result> {
  const me = await requireUser();
  const isAdmin = isAdminRole(me.role);

  // VENDOR_ADMIN can only invite VENDOR_USER into their own vendor.
  if (!isAdmin && me.role !== "VENDOR_ADMIN") {
    return { error: "Not allowed" };
  }

  const raw = {
    email: String(fd.get("email") ?? ""),
    role: String(fd.get("role") ?? ""),
    vendorId: String(fd.get("vendorId") ?? ""),
  };
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  if (!isAdmin) {
    // Force scope: vendor admin can only invite VENDOR_USER into own vendor.
    if (parsed.data.role !== "VENDOR_USER") return { error: "Vendor admins can only invite vendor users" };
    if (parsed.data.vendorId !== me.vendorId) return { error: "Cannot invite into another vendor" };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "A user with this email already exists" };

  const token = crypto.randomBytes(32).toString("base64url");
  const invite = await prisma.vendorInvite.create({
    data: {
      token,
      email: parsed.data.email,
      role: parsed.data.role,
      vendorId: parsed.data.vendorId ?? null,
      invitedById: me.id,
      expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await logWrite("VendorInvite", invite.id, "CREATE", null, { email: invite.email, role: invite.role });
  revalidatePath("/users");

  return { ok: true, token, inviteUrl: inviteUrl(token) };
}

export async function revokeInvite(id: string): Promise<Result> {
  const me = await requireUser();
  const inv = await prisma.vendorInvite.findUnique({ where: { id } });
  if (!inv) return { error: "Invite not found" };
  if (!isAdminRole(me.role) && inv.vendorId !== me.vendorId) return { error: "Not allowed" };
  if (inv.acceptedAt) return { error: "Already accepted — cannot revoke" };

  await prisma.vendorInvite.delete({ where: { id } });
  await logWrite("VendorInvite", id, "DELETE", inv, null);
  revalidatePath("/users");
  return { ok: true };
}

// setUserSuperAdmin was removed in #120 — Margin Report is now open to any
// ADMIN-role user.

export async function setUserCanEdit(id: string, value: boolean): Promise<Result> {
  await requireAdmin();
  try {
    const before = await prisma.user.findUnique({ where: { id }, select: { role: true, canEdit: true } });
    if (!before) return { error: "User not found" };
    if (before.role !== "ADMIN") return { error: "Only admins can be granted editor permission" };
    await prisma.user.update({ where: { id }, data: { canEdit: value } });
    await logWrite("User", id, "UPDATE", { canEdit: before.canEdit }, { canEdit: value });
    revalidatePath("/users");
    return { ok: true };
  } catch {
    return { error: "Failed to update editor flag" };
  }
}

export async function setUserActive(id: string, active: boolean): Promise<Result> {
  await requireAdmin();

  // Atomic: deactivating an admin only succeeds if at least one OTHER active admin remains.
  try {
    const { before, after } = await prisma.$transaction(async (tx) => {
      const b = await tx.user.findUnique({ where: { id } });
      if (!b) throw new Error("USER_NOT_FOUND");
      if (b.role === "ADMIN" && !active) {
        const otherAdmins = await tx.user.count({
          where: { role: "ADMIN", isActive: true, id: { not: id } },
        });
        if (otherAdmins < 1) throw new Error("LAST_ADMIN");
      }
      const a = await tx.user.update({ where: { id }, data: { isActive: active } });
      return { before: b, after: a };
    });
    await logWrite("User", id, "UPDATE", { isActive: before.isActive }, { isActive: after.isActive });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "USER_NOT_FOUND") return { error: "User not found" };
    if (e instanceof Error && e.message === "LAST_ADMIN") return { error: "Cannot deactivate the only active admin" };
    return { error: "Failed to update user" };
  }
}
