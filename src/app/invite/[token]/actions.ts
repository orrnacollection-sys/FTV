"use server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { acceptInviteSchema } from "@/lib/validators/user";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logWrite } from "@/lib/audit";
import { headers } from "next/headers";
import { BCRYPT_ROUNDS } from "@/lib/auth";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

export async function acceptInvite(token: string, fd: FormData): Promise<Result> {
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rl = rateLimit(`invite:${ip}`, 5, 60_000);
  if (!rl.ok) return { error: "Too many attempts — please wait" };

  const parsed = acceptInviteSchema.safeParse({
    username: String(fd.get("username") ?? ""),
    password: String(fd.get("password") ?? ""),
    confirm: String(fd.get("confirm") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  const invite = await prisma.vendorInvite.findUnique({ where: { token } });
  if (!invite) return { error: "Invalid invite" };
  if (invite.acceptedAt) return { error: "Invite already used" };
  if (invite.expiresAt < new Date()) return { error: "Invite expired" };

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: parsed.data.username }, { email: invite.email }] },
  });
  if (existing) return { error: "Username or email already taken" };

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

  let user: { id: string; username: string; role: string };
  try {
    user = await prisma.$transaction(async (tx) => {
      // Atomic claim: only succeeds if not yet accepted.
      const claim = await tx.vendorInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new Error("INVITE_ALREADY_USED");
      }
      return await tx.user.create({
        data: {
          username: parsed.data.username,
          email: invite.email,
          passwordHash,
          role: invite.role,
          vendorId: invite.vendorId,
        },
        select: { id: true, username: true, role: true },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVITE_ALREADY_USED") {
      return { error: "Invite already used" };
    }
    return { error: "Failed to activate account" };
  }
  await logWrite("User", user.id, "CREATE", null, { username: user.username, role: user.role, viaInvite: invite.id });
  return { ok: true };
}
