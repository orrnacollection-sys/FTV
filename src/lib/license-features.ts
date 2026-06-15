/**
 * License feature catalog (#136).
 *
 * The set of plans + the features each plan unlocks. Adding a new
 * feature is two changes here: append it to FEATURES and add it to
 * the right plan(s) in PLAN_FEATURES.
 *
 * Calling code uses `hasFeature(feature)` from `@/lib/licensing` —
 * the catalog itself is dumb data.
 */

export const FEATURES = {
  /** Lets admin create more than one Company. */
  MULTI_COMPANY: "multi_company",
  /** Banking module — Bank Accounts, transactions, reconciliation,
   *  receipt allocation. */
  BANKING: "banking",
  /** GST returns generator — GSTR-1, GSTR-3B, 2B reconciliation. */
  GST_RETURNS: "gst_returns",
  /** Order-level customer receipt allocation. */
  ALLOCATION: "allocation",
  /** Statement import + auto-match reconciliation. */
  RECONCILIATION: "reconciliation",
  /** Daily Sale + Return cron email reports. */
  DAILY_REPORTS: "daily_reports",
  /** Vendor portal access (vendors can log in + see their own data). */
  VENDOR_PORTAL: "vendor_portal",
  /** Public REST API + webhooks for future integrations. */
  API: "api",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export type Plan = "TRIAL" | "BASIC" | "PRO" | "ENTERPRISE";

export const PLAN_LABELS: Record<Plan, string> = {
  TRIAL: "Trial",
  BASIC: "Basic",
  PRO: "Professional",
  ENTERPRISE: "Enterprise",
};

/** Hard caps per plan. UNLIMITED = `Number.MAX_SAFE_INTEGER`. */
export const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PLAN_SEATS: Record<Plan, number> = {
  TRIAL: 1,
  BASIC: 1,
  PRO: 5,
  ENTERPRISE: UNLIMITED,
};

export const PLAN_USERS: Record<Plan, number> = {
  TRIAL: 3,
  BASIC: 5,
  PRO: 25,
  ENTERPRISE: UNLIMITED,
};

/** Trial expires in 30 days from activation. */
export const TRIAL_DAYS = 30;

/** Indicative pricing — used by the comparison table on /settings/license.
 *  Real billing will live in #109 Payment Gateway. */
export const PLAN_PRICE_INR_MONTHLY: Record<Plan, number | null> = {
  TRIAL: 0,
  BASIC: 999,
  PRO: 2999,
  ENTERPRISE: null, // contact sales
};

/** Master plan → features map. */
export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = {
  TRIAL: [
    FEATURES.BANKING,
    FEATURES.GST_RETURNS,
    FEATURES.ALLOCATION,
    FEATURES.RECONCILIATION,
    FEATURES.DAILY_REPORTS,
    FEATURES.VENDOR_PORTAL,
  ],
  BASIC: [
    FEATURES.DAILY_REPORTS,
    FEATURES.VENDOR_PORTAL,
  ],
  PRO: [
    FEATURES.MULTI_COMPANY,
    FEATURES.BANKING,
    FEATURES.GST_RETURNS,
    FEATURES.ALLOCATION,
    FEATURES.RECONCILIATION,
    FEATURES.DAILY_REPORTS,
    FEATURES.VENDOR_PORTAL,
  ],
  ENTERPRISE: [
    FEATURES.MULTI_COMPANY,
    FEATURES.BANKING,
    FEATURES.GST_RETURNS,
    FEATURES.ALLOCATION,
    FEATURES.RECONCILIATION,
    FEATURES.DAILY_REPORTS,
    FEATURES.VENDOR_PORTAL,
    FEATURES.API,
  ],
};

/** Friendly feature labels for the comparison table. */
export const FEATURE_LABELS: Record<Feature, string> = {
  [FEATURES.MULTI_COMPANY]: "Multi-Company",
  [FEATURES.BANKING]: "Banking & Reconciliation",
  [FEATURES.GST_RETURNS]: "GST Returns (GSTR-1, 3B, 2B)",
  [FEATURES.ALLOCATION]: "Order-level Receipt Allocation",
  [FEATURES.RECONCILIATION]: "Statement Import + Auto-Match",
  [FEATURES.DAILY_REPORTS]: "Daily Sale & Return Reports",
  [FEATURES.VENDOR_PORTAL]: "Vendor Portal Access",
  [FEATURES.API]: "REST API + Webhooks",
};
