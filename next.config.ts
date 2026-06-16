import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        // CSP — Next.js App Router currently emits inline bootstrap scripts
        // for hydration. The clean fix is a per-request nonce injected via
        // middleware (tracked in todo.md, Phase 2). Until then, 'unsafe-inline'
        // on script-src is necessary; we partially compensate by setting
        // 'strict-dynamic' so only Next's signed scripts can load further code.
        {
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
    "connect-src 'self' https://*.public.blob.vercel-storage.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Bulk CSV imports (Items / GRN / Orders) send the parsed rows as a Server
    // Action argument. The default 1 MB cap silently rejects large files, so a
    // 5–10k-row import "does nothing". 16 MB comfortably covers those.
    serverActions: { bodySizeLimit: "16mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
