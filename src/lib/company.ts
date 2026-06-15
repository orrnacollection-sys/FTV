/**
 * Single source of truth for the operating company.
 *
 * Pre-SaaS contract:
 *   - Exactly one row in `Company` is marked `isPrimary=true` (seeded).
 *   - `getActiveCompany()` returns that row.
 *
 * Post-SaaS contract (when #106 lands):
 *   - Many Company rows; one per tenant.
 *   - This helper switches to resolving the tenant from the auth context.
 *
 * The rest of the codebase ONLY talks to these helpers — never imports the
 * deprecated `ORG` constant or queries `prisma.company` directly. That's
 * what makes the SaaS migration a single-file change here.
 */
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";

const ACTIVE_COMPANY_COOKIE = "ftv-active-company";

/**
 * Pattern-1 multi-company (shared DB + a `companyId` discriminator
 * column) is **DEFERRED**. See CLAUDE.md §Phase plan. The app behaves
 * as a single company: every company-scoped query resolves to the one
 * primary company, the topbar switcher is hidden, and the create-company
 * action refuses.
 *
 * Flip to `true` ONLY to revive the old `companyId`-based switcher UI for
 * testing. The real multi-company future is **schema-level isolation**
 * (a Postgres schema / database per tenant) — see #106 — **not** this
 * column approach, which gets removed cleanly during that rebuild.
 */
export const MULTI_COMPANY_ENABLED: boolean = false;

/** A summary of a company the topbar switcher displays. */
export type CompanyOption = {
  id: string;
  brandName: string;
  legalName: string;
  isPrimary: boolean;
};

/**
 * Minimal "company header" used on PDFs, invoice templates and page chrome.
 * Includes the default GSTIN — the one we print when no document-level
 * lookup picks a state-specific GSTIN.
 */
export type CompanyHeader = {
  id: string;
  legalName: string;
  brandName: string;
  pan: string | null;
  tan: string | null;
  cin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  email: string | null;
  mobile: string | null;
  website: string | null;
  logoUrl: string | null;
  baseCurrency: string;
  fyStartMonth: number;
  bankName: string | null;
  accountNo: string | null;
  ifsc: string | null;
  /** The default GSTIN — fallback when no other resolver matches. */
  defaultGstin: { gstin: string; state: string } | null;
  /** Printable single-line address: "address, city, state, pincode". */
  addressLine: string;
};

async function loadHeader(): Promise<CompanyHeader> {
  // Resolve which company to fetch from the active-company cookie
  // (#134/#135). Previously this fetched whichever company had
  // isPrimary=true, which meant Company Profile / GSTIN / address /
  // PAN / TAN never changed when you switched companies in the topbar.
  const activeId = await getActiveCompanyId();
  const company = await prisma.company.findUnique({
    where: { id: activeId },
    include: {
      gstins: {
        where: { isActive: true, isDefault: true },
        select: { gstin: true, state: true },
        take: 1,
      },
    },
  });
  if (!company) {
    throw new Error(
      "Active company not found in DB. Run `pnpm db:seed` to seed a primary company.",
    );
  }
  const addressLine = [company.address, company.city, company.state, company.pincode]
    .filter(Boolean)
    .join(", ");
  return {
    id: company.id,
    legalName: company.legalName,
    brandName: company.brandName,
    pan: company.pan,
    tan: company.tan,
    cin: company.cin,
    address: company.address,
    city: company.city,
    state: company.state,
    pincode: company.pincode,
    country: company.country,
    email: company.email,
    mobile: company.mobile,
    website: company.website,
    logoUrl: company.logoUrl,
    baseCurrency: company.baseCurrency,
    fyStartMonth: company.fyStartMonth,
    bankName: company.bankName,
    accountNo: company.accountNo,
    ifsc: company.ifsc,
    defaultGstin: company.gstins[0] ?? null,
    addressLine,
  };
}

/**
 * Returns the active company header. NOT memoized — Next.js's
 * `unstable_cache` keys on the argument list, not request scope, so a
 * single global cache would serve Adwitiya's profile to every company
 * (#135 bug found by user). One extra DB read per page-render is
 * cheap; the bug it prevents is critical.
 */
export async function getActiveCompany(): Promise<CompanyHeader> {
  return loadHeader();
}

/**
 * Get the active company's id — the cheap header-only variant used by
 * server actions that just need to stamp `companyId` on a new row.
 *
 * Resolution order (#134):
 *   1. The `ftv-active-company` cookie, IF the current request still
 *      authorizes that user against the company (admins always do).
 *   2. Falls back to the primary company.
 *
 * Failing closed (throws) when there is no primary.
 */
/** The single primary company's id. The sole source of truth in
 *  single-company mode, and the cookie fallback in multi-company mode. */
async function getPrimaryCompanyId(): Promise<string> {
  const c = await prisma.company.findFirst({
    where: { isPrimary: true, isActive: true },
    select: { id: true },
  });
  if (!c) throw new Error("No primary company configured.");
  return c.id;
}

export async function getActiveCompanyId(): Promise<string> {
  // Multi-company deferred: always operate on the single primary company.
  // Skips the cookie entirely so every read/write resolves to one book.
  if (!MULTI_COMPANY_ENABLED) return getPrimaryCompanyId();

  try {
    const store = await cookies();
    const cookied = store.get(ACTIVE_COMPANY_COOKIE)?.value;
    if (cookied) {
      const exists = await prisma.company.findUnique({
        where: { id: cookied },
        select: { id: true, isActive: true },
      });
      if (exists && exists.isActive) return exists.id;
    }
  } catch {
    // `cookies()` throws outside a request context (e.g. cron / scripts).
    // Fall through to the primary lookup.
  }
  return getPrimaryCompanyId();
}

/** Companies the given user is allowed to load.
 *  - ADMIN: every active company.
 *  - Anyone else: rows from UserCompany.
 *  Returned sorted by brand name with primary first. */
export async function getAccessibleCompanies(
  userId: string,
  role: string,
): Promise<CompanyOption[]> {
  // Multi-company deferred: expose only the single primary company, so the
  // topbar switcher (rendered only when length > 1) stays hidden.
  if (!MULTI_COMPANY_ENABLED) {
    const primary = await prisma.company.findFirst({
      where: { isPrimary: true, isActive: true },
      select: { id: true, brandName: true, legalName: true, isPrimary: true },
    });
    return primary ? [primary] : [];
  }
  if (role === "ADMIN") {
    const all = await prisma.company.findMany({
      where: { isActive: true },
      orderBy: [{ isPrimary: "desc" }, { brandName: "asc" }],
      select: { id: true, brandName: true, legalName: true, isPrimary: true },
    });
    return all;
  }
  const grants = await prisma.userCompany.findMany({
    where: { userId, company: { isActive: true } },
    include: {
      company: { select: { id: true, brandName: true, legalName: true, isPrimary: true } },
    },
  });
  return grants
    .map((g) => g.company)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.brandName.localeCompare(b.brandName));
}

/** Write the active-company cookie. Verifies access first. */
export async function setActiveCompanyId(input: {
  companyId: string;
  userId: string;
  role: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accessible = await getAccessibleCompanies(input.userId, input.role);
  if (!accessible.some((c) => c.id === input.companyId)) {
    return { ok: false, error: "You don't have access to that company." };
  }
  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, input.companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return { ok: true };
}

/** Fetch all GSTINs for the active company, including their places.
 *  Used by the settings page + the Warehouse-form Place picker.
 *  Scoped to the active-company cookie, not the primary flag (#135). */
export async function getActiveCompanyGstins() {
  const companyId = await getActiveCompanyId();
  return prisma.companyGSTIN.findMany({
    where: { companyId },
    include: {
      places: {
        orderBy: [{ placeType: "asc" }, { nickname: "asc" }],
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [{ isDefault: "desc" }, { state: "asc" }],
  });
}

/**
 * Resolve the GSTIN to print as the ship-from on a document, given the
 * state where the goods leave from (typically the warehouse's state).
 *
 * Fall-back chain:
 *   1. Active GSTIN registered in the from-state.
 *   2. The company's default GSTIN.
 *   3. null — caller decides whether that's an error.
 */
export async function resolveShipFromGstin(fromState: string | null | undefined) {
  const header = await getActiveCompany();
  if (!fromState) return header.defaultGstin;
  // Scope to the active company (was hardcoded to isPrimary before).
  const gstin = await prisma.companyGSTIN.findFirst({
    where: { isActive: true, state: fromState, companyId: header.id },
    select: { gstin: true, state: true },
  });
  return gstin ?? header.defaultGstin;
}
