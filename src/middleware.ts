import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

const VENDOR_PREFIXES = ["/portal"];
const ADMIN_PREFIXES = [
  "/dashboard",
  "/vendors",
  "/items",
  "/categories",
  "/warehouses",
  "/models",
  "/users",
  "/purchase-orders",
  "/grn",
  "/rtv",
  "/rfv",
  "/sales",
  "/payments",
  "/or-payments",
  "/other-charges",
  "/stock",
  "/batch-report",
  "/warehouse-stock",
  "/stock-adjustments",
  "/stale-stock",
  "/transfers",
  "/ledger",
  "/audit",
  "/settings",
];

export default middleware((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;

  // Public paths
  if (
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/invite") ||
    path.startsWith("/apply") ||
    path.startsWith("/api/auth") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/api/onboarding")
  ) {
    // Logged-in users hitting /login or / get routed home.
    if (req.auth?.user && (path === "/" || path.startsWith("/login"))) {
      const role = (req.auth.user as { role?: string }).role;
      const dest = role === "ADMIN" ? "/dashboard" : "/portal";
      return Response.redirect(new URL(dest, nextUrl));
    }
    return;
  }

  if (!req.auth?.user) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("next", path);
    return Response.redirect(url);
  }

  const role = (req.auth.user as { role?: string }).role ?? "VENDOR_USER";
  const isAdmin = role === "ADMIN";

  // Admin-only sections — bounce non-admins to /portal.
  if (!isAdmin && ADMIN_PREFIXES.some((p) => path.startsWith(p))) {
    return Response.redirect(new URL("/portal", nextUrl));
  }

  // Vendor sections — admins are allowed (so they can preview); only block other roles
  // when they hit admin-prefixed routes (covered above).
  void VENDOR_PREFIXES; // reserved for future stricter rules
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
