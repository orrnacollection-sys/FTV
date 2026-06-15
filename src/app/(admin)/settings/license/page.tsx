import { requireAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveLicense, seatsAvailable } from "@/lib/licensing";
import {
  PLAN_LABELS,
  PLAN_FEATURES,
  PLAN_SEATS,
  PLAN_USERS,
  FEATURE_LABELS,
  FEATURES,
  PLAN_PRICE_INR_MONTHLY,
  UNLIMITED,
  type Feature,
  type Plan,
} from "@/lib/license-features";
import { Shield, KeyRound, Check, X } from "lucide-react";
import { LicenseForm } from "./LicenseForm";

export const dynamic = "force-dynamic";

const ALL_PLANS: Plan[] = ["TRIAL", "BASIC", "PRO", "ENTERPRISE"];
const ALL_FEATURES = Object.values(FEATURES);

export default async function LicensePage() {
  await requireAdmin();
  const lic = await getActiveLicense();
  const seats = await seatsAvailable();
  const history = await prisma.license.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, plan: true, issuedTo: true, status: true, expiresAt: true, activatedAt: true, issuedAt: true },
  });

  const planTone: Record<string, string> = {
    TRIAL: "bg-amber-100 text-amber-800",
    BASIC: "bg-gray-100 text-gray-800",
    PRO: "bg-blue-100 text-blue-800",
    ENTERPRISE: "bg-violet-100 text-violet-800",
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Shield className="h-7 w-7 text-brand-yellow" /> License
        </h1>
        <p className="text-sm text-ink-faint">
          Keys are HMAC-signed offline tokens. Activate by pasting the key issued by Adwitiya ops —
          features and seat caps unlock automatically.
        </p>
      </div>

      {/* Active license card */}
      <div className="card mb-6">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold flex items-center gap-2">
          Active License
          {lic && <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${planTone[lic.plan]}`}>{lic.plan}</span>}
          {lic?.status === "EXPIRING_SOON" && <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Expiring soon</span>}
          {lic?.status === "EXPIRED" && <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-800">Expired</span>}
        </div>
        {lic ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 text-sm">
            <Kv label="Plan" value={PLAN_LABELS[lic.plan]} />
            <Kv label="Issued To" value={lic.issuedTo} />
            <Kv label="Days Remaining" value={lic.daysRemaining.toString()} tone={lic.status === "EXPIRING_SOON" ? "warn" : lic.status === "EXPIRED" ? "bad" : undefined} />
            <Kv label="Expires" value={lic.expiresAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />
            <Kv label="Seats (Companies)" value={`${seats.used} / ${seats.unlimited ? "∞" : seats.cap}`} tone={!seats.unlimited && seats.remaining === 0 ? "warn" : undefined} />
            <Kv label="Max Users" value={lic.maxUsers >= UNLIMITED ? "Unlimited" : lic.maxUsers.toString()} />
            <Kv label="Activated" value={lic.activatedAt ? lic.activatedAt.toLocaleString("en-IN") : "—"} />
            <Kv label="Features" value={`${lic.features.length}`} />
          </div>
        ) : (
          <div className="p-4 text-sm text-ink-faint">No active license. Paste a key below to activate.</div>
        )}
      </div>

      {/* Activation form */}
      <div className="card mb-6">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Activate License Key
        </div>
        <div className="p-4">
          <LicenseForm />
        </div>
      </div>

      {/* Plan comparison */}
      <div className="card mb-6">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">Plan Comparison</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th text-left">Feature</th>
              {ALL_PLANS.map((p) => (
                <th key={p} className="th text-center">
                  <div className="font-bold">{PLAN_LABELS[p]}</div>
                  <div className="text-[10px] font-normal text-ink-mid">
                    {PLAN_PRICE_INR_MONTHLY[p] === 0
                      ? "Free 30 days"
                      : PLAN_PRICE_INR_MONTHLY[p] === null
                      ? "Contact sales"
                      : `₹${PLAN_PRICE_INR_MONTHLY[p]?.toLocaleString("en-IN")}/mo`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="td font-bold">Companies (seats)</td>
              {ALL_PLANS.map((p) => (
                <td key={p} className="td text-center font-mono">
                  {PLAN_SEATS[p] >= UNLIMITED ? "Unlimited" : PLAN_SEATS[p]}
                </td>
              ))}
            </tr>
            <tr>
              <td className="td font-bold">Max users</td>
              {ALL_PLANS.map((p) => (
                <td key={p} className="td text-center font-mono">
                  {PLAN_USERS[p] >= UNLIMITED ? "Unlimited" : PLAN_USERS[p]}
                </td>
              ))}
            </tr>
            {ALL_FEATURES.map((f) => (
              <tr key={f}>
                <td className="td">{FEATURE_LABELS[f as Feature]}</td>
                {ALL_PLANS.map((p) => {
                  const has = (PLAN_FEATURES[p] as readonly Feature[]).includes(f as Feature);
                  return (
                    <td key={p} className="td text-center">
                      {has ? <Check className="h-4 w-4 text-emerald-700 inline" /> : <X className="h-4 w-4 text-ink-faint inline" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* History */}
      <div className="card">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">License History</div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Plan</th>
              <th className="th">Issued To</th>
              <th className="th text-center">Status</th>
              <th className="th">Issued</th>
              <th className="th">Activated</th>
              <th className="th">Expires</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colSpan={6} className="td text-center py-6 text-ink-faint">No license records yet.</td></tr>
            ) : (
              history.map((h) => (
                <tr key={h.id} className={h.status === "ACTIVE" ? "bg-emerald-50/60" : ""}>
                  <td className="td"><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${planTone[h.plan] ?? ""}`}>{h.plan}</span></td>
                  <td className="td">{h.issuedTo}</td>
                  <td className="td text-center text-[10px] font-bold">{h.status}</td>
                  <td className="td">{h.issuedAt.toLocaleDateString("en-IN")}</td>
                  <td className="td">{h.activatedAt ? h.activatedAt.toLocaleDateString("en-IN") : "—"}</td>
                  <td className="td">{h.expiresAt.toLocaleDateString("en-IN")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint font-bold">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone === "warn" ? "text-amber-700 font-bold" : tone === "bad" ? "text-rose-700 font-bold" : ""}`}>{value}</div>
    </div>
  );
}
