import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/constants";
import { isAdminRole, isVendorRole, ROLES } from "@/lib/constants";

function safeRole(raw: unknown): Role {
  // Anything we don't recognise collapses to the least-privileged role.
  return ROLES.includes(raw as Role) ? (raw as Role) : "VENDOR_USER";
}

export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  vendorId: string | null;
};

/**
 * Reads the current session and returns a typed user shape.
 * Returns null if not signed in.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  const u = session.user as {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string;
    vendorId?: string | null;
  };
  return {
    id: u.id ?? "",
    name: u.name ?? null,
    email: u.email ?? null,
    role: safeRole(u.role),
    vendorId: u.vendorId ?? null,
  };
}

/** Redirect to /login if not signed in. Returns the user otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** 403 if the user is not ADMIN. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isAdminRole(u.role)) {
    throw new Error("Forbidden: admin only");
  }
  // Defensive: a JWT can outlive a DB reseed (the User row gets a new id while
  // the session still carries the old one). Verify the row exists so downstream
  // FK writes (e.g. VendorInvite.invitedById) don't fail with opaque errors.
  // Throwing here would surface as an unhandled runtime error in pages, so
  // redirect to /login instead — that forces a fresh JWT.
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, isActive: true } });
  if (!row || !row.isActive) {
    redirect("/login?error=session-stale");
  }
  return u;
}

// The super-admin gate was removed in #120 — Margin Report is now visible to
// any ADMIN-role user. `User.isSuperAdmin` no longer exists on the schema.

/**
 * Editor gate. Admin role + the `canEdit` flag. Mutating server actions
 * (create/update/delete/import) wrap with this so view-only admins can't bypass
 * a hidden button by hitting the action URL directly.
 */
export async function requireEditor(): Promise<SessionUser> {
  const u = await requireAdmin();
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { canEdit: true } });
  if (!row?.canEdit) {
    throw new Error("Forbidden: editor permission required");
  }
  return u;
}

/** Convenience boolean — true if the current admin is allowed to edit. */
export async function isEditor(): Promise<boolean> {
  const u = await getCurrentUser();
  if (!u || !isAdminRole(u.role)) return false;
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { canEdit: true } });
  return row?.canEdit ?? false;
}

/** Returns the user if VENDOR_ADMIN or VENDOR_USER, throws otherwise. */
export async function requireVendor(): Promise<SessionUser & { vendorId: string }> {
  const u = await requireUser();
  if (!isVendorRole(u.role) || !u.vendorId) {
    throw new Error("Forbidden: vendor account required");
  }
  // Same stale-JWT guard as requireAdmin — see note there.
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, isActive: true } });
  if (!row || !row.isActive) {
    redirect("/login?error=session-stale");
  }
  return u as SessionUser & { vendorId: string };
}

/**
 * Returns a Prisma `where` fragment that scopes a query to the current user's
 * accessible data. Admins see everything (returns empty {}); vendor users see
 * only their own vendor's rows.
 *
 * Usage:
 *   const scope = await scopeByVendor("vendorId");
 *   await prisma.item.findMany({ where: { ...scope, ...otherFilters } });
 */
export async function scopeByVendor(
  field: string = "vendorId",
): Promise<Record<string, string> | Record<string, never>> {
  const u = await requireUser();
  if (isAdminRole(u.role)) return {};
  if (isVendorRole(u.role) && u.vendorId) return { [field]: u.vendorId };
  throw new Error("Forbidden: unknown role");
}
