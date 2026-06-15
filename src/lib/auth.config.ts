import type { NextAuthConfig } from "next-auth";

// Edge-safe config — used by middleware. No DB / bcrypt here.
export const authConfig = {
  pages: { signIn: "/login" },
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [], // Real provider lives in auth.ts (Node runtime only).
  callbacks: {
    // We run our own redirect logic in src/middleware.ts (it needs to allow
    // /apply, /invite, /api/onboarding etc. as public). Returning true here
    // lets the middleware function execute; without this Auth.js would short-
    // circuit unauth users to /login *before* our public-path check fires.
    authorized: () => true,
    jwt: ({ token, user }) => {
      if (user) {
        // Auth.js v5 auto-populates token.sub with user.id, but we also stash
        // it on token.id for clarity. Without this, session.user.id would never
        // be available — and downstream FK writes (VendorInvite.invitedById,
        // audit log createdBy, etc.) would fail with opaque errors.
        token.id = (user as { id?: string }).id;
        token.role = (user as { role?: string }).role;
        token.vendorId = (user as { vendorId?: string | null }).vendorId;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        (session.user as { id?: string }).id =
          ((token.id as string | undefined) ?? token.sub) as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { vendorId?: string | null }).vendorId =
          token.vendorId as string | null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
