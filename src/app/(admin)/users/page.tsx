import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { UsersPanel } from "./UsersPanel";

export default async function UsersPage() {
  await requireAdmin();

  const [users, invites, vendors] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { vendor: { select: { code: true, name: true } } },
    }),
    prisma.vendorInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: "desc" },
      include: { vendor: { select: { code: true, name: true } } },
    }),
    prisma.vendor.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Users & Invites</h1>
        <p className="text-sm text-ink-faint">Manage admins and vendor user accounts.</p>
      </div>
      <UsersPanel
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          canEdit: u.canEdit,
          vendorName: u.vendor ? `${u.vendor.code} · ${u.vendor.name}` : null,
          lastLoginAt: u.lastLoginAt,
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          vendorName: i.vendor ? `${i.vendor.code} · ${i.vendor.name}` : null,
          expiresAt: i.expiresAt,
          token: i.token,
        }))}
        vendors={vendors}
      />
    </div>
  );
}
