import Link from "next/link";
import { AlertTriangle, ShieldX } from "lucide-react";
import { getActiveLicense, reapExpired, ensureTrialIfUnlicensed } from "@/lib/licensing";

/** Server Component banner that:
 *   1. Flips expired licenses to EXPIRED state.
 *   2. Auto-issues a TRIAL on first-run / unlicensed installations.
 *   3. Renders a banner only when the active license is EXPIRING_SOON
 *      or EXPIRED. Stays silent otherwise so the UI isn't noisy.
 */
export async function LicenseBanner() {
  await reapExpired();
  let lic = await getActiveLicense();
  if (!lic) {
    // First-run bootstrap — auto-issue trial.
    lic = await ensureTrialIfUnlicensed();
  }
  if (!lic) return null;
  if (lic.status === "ACTIVE") return null;

  const isExpired = lic.status === "EXPIRED";
  const tone = isExpired ? "bg-rose-50 border-rose-200 text-rose-900" : "bg-amber-50 border-amber-200 text-amber-900";

  return (
    <div className={`border-b px-3 md:px-6 py-1.5 text-xs flex items-center gap-2 ${tone}`}>
      {isExpired ? <ShieldX className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {isExpired ? (
        <span>
          <strong>License expired</strong> on {lic.expiresAt.toLocaleDateString("en-IN")}. Some
          features are disabled.
        </span>
      ) : (
        <span>
          <strong>{lic.daysRemaining} days</strong> left on your {lic.plan} license (expires{" "}
          {lic.expiresAt.toLocaleDateString("en-IN")}).
        </span>
      )}
      <Link href="/settings/license" className="ml-auto font-bold underline hover:no-underline">
        {isExpired ? "Activate a new key →" : "Renew / Upgrade →"}
      </Link>
    </div>
  );
}
