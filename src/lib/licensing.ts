/**
 * Licensing layer (#136).
 *
 * License keys are self-contained, HMAC-signed payloads — no
 * phone-home required. Format:
 *
 *   FTV-<base64url(payload)>.<hex(hmac)>
 *
 * Payload (JSON):
 *   {
 *     v: 1,                       // schema version
 *     plan: "PRO",
 *     seats: 5,
 *     maxUsers: 25,
 *     features: ["banking", ...],
 *     issuedTo: "Adwitiya Global",
 *     issuedAt: "2026-06-02T00:00:00Z",
 *     expiresAt: "2027-06-02T00:00:00Z",
 *     nonce: "<random>",          // dedupes keys with identical content
 *   }
 *
 * The HMAC is computed with `LICENSE_SIGNING_KEY` (env var). Same key
 * lives in the mint tool. Rotating the signing key invalidates every
 * outstanding license — keep it stable in prod.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  FEATURES,
  PLAN_FEATURES,
  PLAN_SEATS,
  PLAN_USERS,
  TRIAL_DAYS,
  type Feature,
  type Plan,
} from "@/lib/license-features";

const KEY_PREFIX = "FTV-";

/** Resolve the signing secret. Defaults to a dev fallback so the app
 *  runs out of the box; production should set LICENSE_SIGNING_KEY in
 *  Vercel envs. */
function signingSecret(): string {
  const v = process.env.LICENSE_SIGNING_KEY;
  if (v && v.length >= 16) return v;
  // Dev fallback — stable so trial keys minted today survive a restart.
  return "ftv-dev-signing-key-rotate-in-prod-please";
}

export type LicensePayload = {
  v: 1;
  plan: Plan;
  seats: number;
  maxUsers: number;
  features: Feature[];
  issuedTo: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
};

// ── Mint + verify ─────────────────────────────────────────────────────

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Mint a signed license key from a payload. Used by the CLI tool. */
export function mintLicense(payload: LicensePayload): string {
  const json = JSON.stringify(payload);
  const body = base64urlEncode(Buffer.from(json, "utf8"));
  const hmac = createHmac("sha256", signingSecret()).update(body).digest("hex");
  return `${KEY_PREFIX}${body}.${hmac}`;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: string };

/** Verify a license key string. Returns the parsed payload on success.
 *  Refuses tampered, malformed, or expired keys. */
export function verifyLicense(key: string): VerifyResult {
  const trimmed = (key ?? "").trim();
  if (!trimmed.startsWith(KEY_PREFIX)) return { ok: false, error: "Not a valid FTV license key" };
  const rest = trimmed.slice(KEY_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot < 0) return { ok: false, error: "Malformed key (missing signature separator)" };
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expected = createHmac("sha256", signingSecret()).update(body).digest("hex");
  if (sig.length !== expected.length) return { ok: false, error: "Signature length mismatch" };
  // Timing-safe compare so we don't leak which prefix matched.
  if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
    return { ok: false, error: "Invalid signature — key was tampered with or signed by a different installation" };
  }
  let payload: LicensePayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8")) as LicensePayload;
  } catch {
    return { ok: false, error: "Corrupted payload" };
  }
  if (payload.v !== 1) return { ok: false, error: `Unsupported license version ${payload.v}` };
  if (!payload.plan || !payload.seats || !payload.issuedTo) {
    return { ok: false, error: "Payload missing required fields" };
  }
  const exp = new Date(payload.expiresAt);
  if (isNaN(exp.getTime())) return { ok: false, error: "Bad expiresAt date" };
  if (exp.getTime() < Date.now()) return { ok: false, error: `License expired on ${exp.toLocaleDateString("en-IN")}` };
  return { ok: true, payload };
}

// ── Activation + status ───────────────────────────────────────────────

export type ActiveLicense = {
  id: string;
  key: string;
  plan: Plan;
  seats: number;
  maxUsers: number;
  features: Feature[];
  issuedTo: string;
  issuedAt: Date;
  expiresAt: Date;
  activatedAt: Date | null;
  daysRemaining: number;
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";
};

/** Get the currently active license, or null if none. Also returns
 *  "EXPIRING_SOON" status when within 7 days of expiry. */
export async function getActiveLicense(): Promise<ActiveLicense | null> {
  const row = await prisma.license.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { activatedAt: "desc" },
  });
  if (!row) return null;
  const now = Date.now();
  const exp = row.expiresAt.getTime();
  const ms = exp - now;
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  let status: ActiveLicense["status"] = "ACTIVE";
  if (ms < 0) status = "EXPIRED";
  else if (days <= 7) status = "EXPIRING_SOON";
  let features: Feature[] = [];
  try { features = JSON.parse(row.features) as Feature[]; } catch { /* leave empty */ }
  return {
    id: row.id,
    key: row.key,
    plan: row.plan as Plan,
    seats: row.seats,
    maxUsers: row.maxUsers,
    features,
    issuedTo: row.issuedTo,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    activatedAt: row.activatedAt,
    daysRemaining: days,
    status,
  };
}

/** True if the active license carries the given feature. Treats an
 *  expired or missing license as "no" so the gate fails closed. */
export async function hasFeature(feature: Feature): Promise<boolean> {
  const lic = await getActiveLicense();
  if (!lic || lic.status === "EXPIRED") return false;
  return lic.features.includes(feature);
}

/** Seat budget — number of Company rows admin can still create. */
export async function seatsAvailable(): Promise<{
  used: number;
  cap: number;
  remaining: number;
  unlimited: boolean;
}> {
  const lic = await getActiveLicense();
  const cap = lic?.seats ?? 1;
  const used = await prisma.company.count({ where: { isActive: true } });
  const unlimited = cap >= Number.MAX_SAFE_INTEGER;
  return { used, cap, remaining: Math.max(0, cap - used), unlimited };
}

/** Activate a pasted license key. Demotes the prior ACTIVE license
 *  (if any) to REPLACED, persists the new one with status ACTIVE. */
export async function activateLicense(key: string): Promise<
  { ok: true; license: ActiveLicense } | { ok: false; error: string }
> {
  const verify = verifyLicense(key);
  if (!("ok" in verify) || !verify.ok) return { ok: false, error: "error" in verify ? verify.error : "Invalid key" };
  const payload = verify.payload;

  // Guard against re-activating the same key.
  const existing = await prisma.license.findUnique({ where: { key } });
  if (existing && existing.status === "ACTIVE") {
    return { ok: false, error: "This license is already active." };
  }
  if (existing && existing.status === "REVOKED") {
    return { ok: false, error: "This license was revoked — contact support." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.license.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "REPLACED" },
    });
    if (existing) {
      await tx.license.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
    } else {
      await tx.license.create({
        data: {
          key,
          plan: payload.plan,
          seats: payload.seats,
          maxUsers: payload.maxUsers,
          features: JSON.stringify(payload.features),
          issuedTo: payload.issuedTo,
          issuedAt: new Date(payload.issuedAt),
          expiresAt: new Date(payload.expiresAt),
          status: "ACTIVE",
          activatedAt: new Date(),
        },
      });
    }
  });

  const lic = await getActiveLicense();
  if (!lic) return { ok: false, error: "Activation persisted but license read back null" };
  return { ok: true, license: lic };
}

/** Idempotent — ensure SOMETHING is active. If nothing is, mint and
 *  activate a TRIAL license valid for TRIAL_DAYS days. Called on
 *  bootstrap from the auth flow. */
export async function ensureTrialIfUnlicensed(): Promise<ActiveLicense | null> {
  const lic = await getActiveLicense();
  if (lic && lic.status !== "EXPIRED") return lic;

  const now = new Date();
  const exp = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const payload: LicensePayload = {
    v: 1,
    plan: "TRIAL",
    seats: PLAN_SEATS.TRIAL,
    maxUsers: PLAN_USERS.TRIAL,
    features: [...PLAN_FEATURES.TRIAL],
    issuedTo: "Trial Installation",
    issuedAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    nonce: randomBytes(8).toString("hex"),
  };
  const key = mintLicense(payload);
  const r = await activateLicense(key);
  if (!("ok" in r) || !r.ok) return null;
  return r.license;
}

/** Mark the currently ACTIVE license EXPIRED if it's past expiresAt.
 *  Idempotent. Called from the topbar load. */
export async function reapExpired(): Promise<void> {
  await prisma.license.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

// Re-export so call sites can stay in one import line.
export { FEATURES, type Feature, type Plan };
