# Adwitiya FTV — Project Brief for Claude Code

This file is the **single source of truth** for the project. Read it at the start of every session before touching code. Update it (with a small focused diff) whenever an architecture decision, coding standard, or phase boundary changes.

---

## 1. Product

A web-based ERP for **Adwitiya Global** (Surajpur, Greater Noida; GST `09AJLKHJK1CCF`). One organization, many **vendors**. Each vendor has multiple **users with roles**.

Modules: Vendor Master · Item Master · Categories · Purchase Orders · GRN / Purchase · Sales · Payments · Vendor Ledger · Stock Report · Warehouse Transfer · Reports (GST, KPI) · Tickets · Agreements (later phases).

## 2. Users & Roles

This is **NOT multi-tenant**. It is a **single-tenant, multi-vendor** system.

| Role | Scope | What they can do |
|---|---|---|
| `ADMIN` | Global (Adwitiya) | Everything — full CRUD on all data, manage vendors, invite users (admins or vendor admins) |
| `VENDOR_ADMIN` | Their own vendor only | View their own data + invite/manage `VENDOR_USER` accounts within their vendor |
| `VENDOR_USER` | Their own vendor only | Read-only view of their own vendor's data (items, POs, GRNs, sales, payments, ledger) |

**Account creation is invite-only.** No public signup. Admin creates a vendor record, then invites a person to be that vendor's `VENDOR_ADMIN`. The vendor admin invites additional users within their vendor.

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Vercel (single region — bom1 / cdg1 for India + EU access)         │
│  ┌────────────────────────────────────────────────────┐            │
│  │ Next.js 15 (App Router, React 19 Server Components)│            │
│  │  • Edge middleware: auth gate                       │            │
│  │  • Node runtime: server actions, API routes         │            │
│  │  • Static assets: CDN-cached                        │            │
│  └────────────────────┬───────────────────────────────┘            │
│                       │ Prisma (connection pooling)                 │
└───────────────────────┼─────────────────────────────────────────────┘
                        │
              ┌─────────▼─────────┐         ┌──────────────────┐
              │ Neon Postgres     │         │ Vercel Blob      │
              │ (prod) / SQLite   │         │ (images, PDFs)   │
              │ (dev)             │         └──────────────────┘
              └───────────────────┘
                        ▲
              ┌─────────┴─────────┐
              │ Resend (email)    │
              │ wa.me (WA links)  │
              └───────────────────┘
```

### Stack
- **Framework**: Next.js 15.0.3 (App Router) + TypeScript 5.6 (strict)
- **DB ORM**: Prisma 5.22 — SQLite dev, Postgres prod (same schema; Prisma data-proxy/Neon pooled URL in prod)
- **Auth**: Auth.js v5 (next-auth 5.0.0-beta) + bcryptjs (rounds=12); JWT sessions; HTTPS-only secure cookies in prod
- **UI**: Tailwind 3.4, lucide-react icons, react-hot-toast, tailwindcss-animate; Poppins (headings via `font-display`) + Lato (body / data via default `font-sans`)
- **Forms**: React Hook Form isn't used — server actions + native HTML forms + Zod validators keep the bundle thin
- **CSV**: papaparse
- **PDF**: @react-pdf/renderer (Phase 2)
- **Email**: Resend (Phase 2)

### Folder layout
```
adwitiya-ftv/
├─ CLAUDE.md                 ← this file
├─ todo.md                   ← task tracker (update as work progresses)
├─ legacy/                   ← original HTML prototypes (read-only reference)
├─ prisma/
│   ├─ schema.prisma         ← DB schema
│   ├─ seed.ts               ← admin seed + series init
│   └─ migrations/           ← committed migrations
├─ public/uploads/           ← local dev images (Vercel Blob in prod)
├─ scripts/
│   ├─ dev.ps1               ← local dev: stop+start in one command
│   ├─ stop.ps1              ← kill the dev server
│   └─ deploy.ps1            ← prod deploy: db push → build → deploy
├─ src/
│   ├─ app/
│   │   ├─ login/
│   │   ├─ invite/[token]/   ← accept-invite flow
│   │   ├─ (admin)/          ← ADMIN-only routes
│   │   │   ├─ layout.tsx
│   │   │   ├─ dashboard/
│   │   │   ├─ vendors/
│   │   │   ├─ items/
│   │   │   ├─ categories/
│   │   │   ├─ users/
│   │   │   └─ … (phase 2+)
│   │   ├─ (vendor)/         ← VENDOR_ADMIN + VENDOR_USER routes
│   │   │   └─ portal/
│   │   ├─ api/auth/[...nextauth]/
│   │   └─ layout.tsx · page.tsx · globals.css
│   ├─ components/           ← Sidebar, Topbar, shared UI primitives
│   ├─ hooks/                ← useUnsavedChanges, useToast, …
│   ├─ lib/
│   │   ├─ auth.ts           ← full auth (Node runtime — uses bcrypt)
│   │   ├─ auth.config.ts    ← edge-safe config (middleware)
│   │   ├─ db.ts             ← Prisma singleton
│   │   ├─ rbac.ts           ← requireRole(), getCurrentUser(), scopeByVendor()
│   │   ├─ audit.ts          ← logWrite() wrapper
│   │   ├─ rate-limit.ts     ← lightweight per-IP limiter
│   │   ├─ csv.ts · date.ts · uploads.ts · constants.ts · utils.ts
│   │   └─ validators/       ← Zod schemas (one per entity)
│   └─ middleware.ts         ← auth gate + role routing
└─ next.config.ts · tailwind.config.ts · postcss.config.mjs · tsconfig.json
```

## 4. Coding Standards (non-negotiable)

### Single-company scope (current posture)

The product is **single-company** for now — one organization (Adwitiya), many vendors. A Pattern-1 multi-company layer (shared DB + a `companyId` discriminator column + topbar company switcher) was built in tasks **#133–#136** and is now **deferred**: it is neutralized behind `MULTI_COMPANY_ENABLED = false` in `src/lib/company.ts`. With the flag off, `getActiveCompanyId()` always resolves to the single primary company, the switcher and `/companies` CRUD are hidden, and `createCompany()` refuses — so every company-scoped query trivially resolves to one book. The `companyId` columns and `companyWhere()` scoping remain in place but **inert**; do not rely on them or extend them.

**Do not** build new multi-company plumbing on the `companyId` column. When multi-company returns it will use **schema-level data isolation (a Postgres schema / database per tenant) — not a `companyId` discriminator column** (see Phase 7). The existing `companyId` columns get removed cleanly during that rebuild, so adding more now is throwaway work pointed at the wrong design.

### Other rules

1. **TypeScript strict**. No `any`. Use `unknown` + narrowing if you don't know the type.
2. **Zod at every trust boundary** — form data, query params, CSV imports, env vars. Never trust user input.
3. **Server actions only for mutations**. No public REST routes unless absolutely required (e.g. webhooks). Server actions are CSRF-safe by default on Next.js 15.
4. **Filter by role + vendorId at the query level**, not in the component. Use the helpers in `src/lib/rbac.ts`. Forgetting this is a data-leak bug.
5. **Audit every write**. Call `logWrite()` inside server actions that mutate state — before/after JSON + actor.
6. **No `dangerouslySetInnerHTML`** unless escaped explicitly.
7. **No inline secrets**. Always `process.env.X` validated via `src/lib/env.ts` (Zod schema).
8. **DD-MM-YYYY in UI, ISO in storage**. Always use the helpers in `src/lib/date.ts`.
9. **Comments only when WHY is non-obvious**. Never narrate WHAT — names should do that.
10. **Don't add deps lightly**. Each new dep needs a one-line justification in the PR/commit. Prefer building small over pulling 50 KB.
11. **Server Components by default**. Add `"use client"` only when the file uses state, effects, or browser-only APIs.
12. **Tests** (introduced from Phase 2): Vitest for `lib/`, Playwright smoke tests for critical flows (login, vendor CRUD, PO creation).

## 5. Security Posture

| Concern | Mitigation |
|---|---|
| Credential stuffing | bcrypt rounds = 12, rate-limit login (5/min/IP) |
| Session hijack | JWT in httpOnly + secure + sameSite=lax cookie (prod); short rotation |
| CSRF | Next.js server actions + Auth.js origin check; no public mutating GETs |
| XSS | React auto-escapes; no `dangerouslySetInnerHTML`; CSP header (no inline scripts) |
| SQL injection | Prisma parameterizes everything; no raw `$queryRawUnsafe` |
| Privilege escalation | `requireRole()` / `requireAdmin()` at the *top* of every server action |
| Data leak across vendors | `scopeByVendor()` helper applied to every query touching vendor-owned data |
| File upload abuse | Allowlist MIME + size (5 MB) + content sniff; never serve from same origin as auth cookies in prod (Blob is on a separate domain) |
| Brute-force invites | Single-use tokens, 7-day expiry, invalidated after first use |
| Secrets in repo | `.env` gitignored; `.env.example` committed; Vercel envs only set in Vercel dashboard |
| HTTP | Vercel enforces HTTPS; HSTS header added in `next.config.ts` |
| Click-jacking | `X-Frame-Options: DENY` via headers |

A `security-review` skill is invoked at the end of every phase. Findings become tasks.

## 6. Performance Posture

| Concern | Approach |
|---|---|
| Cold start | Single region; Edge middleware only for auth check; rest on Node |
| Bundle size | Server Components by default; no UI framework (no Material/Ant); lucide tree-shakes |
| Query latency | Indexes on hot lookups (vendor name, item skuCode, PO grnDate); Prisma `select`/`include` only fetches what's needed |
| Hydration cost | `"use client"` only where required; forms use native submit + server actions |
| Image perf | `next/image` for SKU images (lazy + responsive); CSS transitions over JS where possible |
| TTFB on Neon | Use the pooled connection URL (`?pgbouncer=true&connection_limit=1`) |
| Pagination | All list pages will get cursor pagination once row counts pass 100 |

## 7. Deployment

### One-time setup
1. Create Neon project → copy pooled connection string.
2. Create Vercel project from this repo.
3. In Vercel env vars (Production + Preview):
   - `DATABASE_URL` — Neon pooled URL
   - `DIRECT_URL` — Neon direct URL (for migrations)
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `AUTH_TRUST_HOST=true`
   - `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL` (for first deploy only)
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
   - `BLOB_READ_WRITE_TOKEN` (after enabling Vercel Blob)
4. Update `prisma/schema.prisma` `provider` from `sqlite` to `postgresql` (datasource block stays).
5. Run `pnpm scripts/deploy.ps1` (or via Vercel CLI).

> **Schema-sync strategy — `db push`, not migrations.** The schema was built with
> `prisma db push` (dialect-agnostic across SQLite dev / Postgres prod), and the
> committed `prisma/migrations/` are an incomplete legacy snapshot — **do not run
> `prisma migrate deploy/reset`** (they build a partial schema and fail). Both
> `db:reset` and `deploy.ps1` use **`prisma db push`** to recreate the full schema
> from `schema.prisma`. After the **first** prod deploy, seed the baseline once:
> `npx dotenv -e .env.production -- tsx prisma/seed.ts` (admin + company + CoA +
> models + series). Build-script approvals for pnpm 11 live in `pnpm-workspace.yaml`.

### Cost estimate (monthly, low-traffic)
- Neon free tier: $0 (3 GB storage, suspends after inactivity)
- Vercel hobby: $0
- Resend free tier: 100 emails/day free
- Vercel Blob: $0.15/GB stored, $0.10/GB transferred
- **Total at small scale: ~$0–5/month**

Scaling thresholds (when to pay):
- Neon Launch ($19/mo) when DB exceeds 3 GB or needs always-on
- Vercel Pro ($20/mo) when team grows or needs SSO
- Resend Pro ($20/mo) at 50K emails/mo

## 8. Phase plan

See `todo.md` for live tasks. High level:

- **Phase 0** ✅ Foundation: scaffold, auth, base layout
- **Phase 1** ✅ Core masters: Vendor, Item, Category
- **Phase 1.5** 🟡 Multi-vendor users + roles + UI polish + ops scripts + CLAUDE.md/todo.md
- **Phase 2** ⬜ Transactions: PO, GRN, Sales, Stock, Warehouse Transfer
- **Phase 3** ⬜ Money: Payment, Vendor Ledger, daily reports, email
- **Phase 4** ⬜ Vendor portal completion (all read views)
- **Phase 5** ⬜ Compliance: GSTR-1, GSTR-3B, GSTR-2A
- **Phase 6** ⬜ Advanced ops: tickets, KPI board, multi-warehouse, shipping, agreements, role matrix UI, backup/restore
- **Phase 7 (deferred)** ⬜ Multi-company — **schema-level data isolation** (separate Postgres schema or database per company; **not** a `companyId` column). The Pattern-1 `companyId` layer built in #133–#136 is shelved/inert (`MULTI_COMPANY_ENABLED = false`); it is replaced — not extended — when this phase is scheduled. Mechanism (schema-per-tenant vs DB-per-tenant), tenant routing, per-tenant migrations, and connection strategy to be designed then.

## 9. Working with this repo

### Local dev
```pwsh
pnpm install
pnpm scripts/dev.ps1    # stops anything on :3000, starts fresh
# or just `pnpm dev`
```
Visit `http://localhost:3000` → `/login` → `ankur` / `ankur@123`.

### Reset DB
```pwsh
pnpm db:reset           # db push --force-reset (full schema) + re-seeds
```

### Production deploy
```pwsh
pnpm scripts/deploy.ps1
```

### Code review (after each phase)
Invoke the `/code-review` skill or run the security-review skill. Findings → `todo.md`.

## 10. House rules for Claude Code sessions

- **Always** read this file + `todo.md` at the start of a session.
- **Commit** at the end of each completed task (or every ~60 minutes of work), with a descriptive subject line.
- **Update todo.md** as tasks change state (don't let it drift).
- **Ask before** changing the schema, adding a new dep > 30 KB, or modifying anything in `scripts/`.
- **Run** `pnpm typecheck` + `pnpm build` before any commit. If either fails, fix before committing.
- When in doubt about a requirement, **ask once** with a concrete option set rather than guess.
