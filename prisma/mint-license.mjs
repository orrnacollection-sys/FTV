#!/usr/bin/env node
/**
 * License key mint tool (#136).
 *
 * Usage:
 *   node prisma/mint-license.mjs --plan PRO --seats 5 --users 25 \
 *     --to "Adwitiya Global" --months 12
 *
 *   --plan      TRIAL | BASIC | PRO | ENTERPRISE   (required)
 *   --seats     N                                   (default per-plan)
 *   --users     N                                   (default per-plan)
 *   --to        Customer name                       (required)
 *   --months    Validity in months                  (default 12)
 *   --features  comma-separated override            (default per-plan)
 *
 * Prints the signed key. Save it and hand it to the customer; they
 * paste it into Settings → License → Activate.
 *
 * The HMAC signing key is read from LICENSE_SIGNING_KEY env var with
 * the same dev fallback the runtime uses. Rotate carefully — keys
 * minted with the old secret stop verifying.
 */
import { createHmac, randomBytes } from "node:crypto";

// Keep these in sync with src/lib/license-features.ts. Duplicated
// here so the CLI works without a TS toolchain.
const FEATURES = {
  MULTI_COMPANY: "multi_company",
  BANKING: "banking",
  GST_RETURNS: "gst_returns",
  ALLOCATION: "allocation",
  RECONCILIATION: "reconciliation",
  DAILY_REPORTS: "daily_reports",
  VENDOR_PORTAL: "vendor_portal",
  API: "api",
};

const PLAN_FEATURES = {
  TRIAL: ["banking", "gst_returns", "allocation", "reconciliation", "daily_reports", "vendor_portal"],
  BASIC: ["daily_reports", "vendor_portal"],
  PRO: ["multi_company", "banking", "gst_returns", "allocation", "reconciliation", "daily_reports", "vendor_portal"],
  ENTERPRISE: ["multi_company", "banking", "gst_returns", "allocation", "reconciliation", "daily_reports", "vendor_portal", "api"],
};

const UNLIMITED = Number.MAX_SAFE_INTEGER;
const PLAN_SEATS = { TRIAL: 1, BASIC: 1, PRO: 5, ENTERPRISE: UNLIMITED };
const PLAN_USERS = { TRIAL: 3, BASIC: 5, PRO: 25, ENTERPRISE: UNLIMITED };

function argv(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

const plan = argv("plan");
const to = argv("to");
const seatsArg = argv("seats");
const usersArg = argv("users");
const months = Number(argv("months", "12"));
const featuresArg = argv("features");

if (!plan || !PLAN_FEATURES[plan]) {
  console.error("Missing or invalid --plan. Must be TRIAL | BASIC | PRO | ENTERPRISE.");
  process.exit(2);
}
if (!to) {
  console.error('Missing --to "<customer name>".');
  process.exit(2);
}

const signingSecret = process.env.LICENSE_SIGNING_KEY && process.env.LICENSE_SIGNING_KEY.length >= 16
  ? process.env.LICENSE_SIGNING_KEY
  : "ftv-dev-signing-key-rotate-in-prod-please";

const now = new Date();
const exp = new Date(now);
exp.setMonth(exp.getMonth() + months);

const payload = {
  v: 1,
  plan,
  seats: seatsArg ? Number(seatsArg) : PLAN_SEATS[plan],
  maxUsers: usersArg ? Number(usersArg) : PLAN_USERS[plan],
  features: featuresArg ? featuresArg.split(",").map((s) => s.trim()) : PLAN_FEATURES[plan],
  issuedTo: to,
  issuedAt: now.toISOString(),
  expiresAt: exp.toISOString(),
  nonce: randomBytes(8).toString("hex"),
};

function base64urlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const body = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
const hmac = createHmac("sha256", signingSecret).update(body).digest("hex");
const key = `FTV-${body}.${hmac}`;

console.log(`\n=== License key for ${to} (${plan}) ===`);
console.log(`Seats: ${payload.seats >= UNLIMITED ? "unlimited" : payload.seats}`);
console.log(`Users: ${payload.maxUsers >= UNLIMITED ? "unlimited" : payload.maxUsers}`);
console.log(`Features: ${payload.features.join(", ")}`);
console.log(`Valid: ${now.toISOString().slice(0, 10)} → ${exp.toISOString().slice(0, 10)}`);
console.log(`\n${key}\n`);
