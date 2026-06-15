import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";

export const BCRYPT_ROUNDS = 12;

// Constant-time decoy for missing users. Avoids leaking "user exists" via timing.
// Generated once at module load.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { username: username.toLowerCase() },
        });

        // Run a bcrypt compare unconditionally to keep response time uniform
        // whether the user exists or not. Prevents enumeration via timing.
        const hash = user?.passwordHash ?? DUMMY_HASH;
        const ok = await bcrypt.compare(password, hash);

        if (!user || !user.isActive || !ok) return null;

        // Fire-and-forget lastLoginAt update — don't block the auth flow.
        prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }).catch(() => {});

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          vendorId: user.vendorId,
        };
      },
    }),
  ],
});
