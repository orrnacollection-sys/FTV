import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ShortcutHint } from "@/components/ShortcutHint";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { PeriodControl } from "@/components/PeriodControl";
import { getActiveCompanyId, getAccessibleCompanies } from "@/lib/company";
import { getActivePeriod } from "@/lib/period";
import { isoUtc } from "@/lib/fy";

export async function Topbar() {
  const session = await auth();
  const username = session?.user?.name ?? "guest";
  const role = (session?.user as { role?: string } | undefined)?.role ?? "ADMIN";

  // Load companies the user can switch to. Look up by username since
  // session may not carry the user id directly.
  let companies: Awaited<ReturnType<typeof getAccessibleCompanies>> = [];
  let activeId = "";
  if (session?.user) {
    const me = await prisma.user.findUnique({
      where: { username: username },
      select: { id: true, role: true },
    });
    if (me) {
      companies = await getAccessibleCompanies(me.id, me.role);
      activeId = await getActiveCompanyId();
    }
  }
  void role;

  const period = await getActivePeriod();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-white/80 backdrop-blur px-3 md:px-6">
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <MobileMenuButton />
        <Link href="/dashboard" className="hover:text-ink">Home</Link>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {companies.length > 1 && (
          <CompanySwitcher companies={companies} activeId={activeId} />
        )}
        <PeriodControl
          label={period.label}
          fromIso={isoUtc(period.from)}
          toIso={isoUtc(period.to)}
          fyStartMonth={period.fyStartMonth}
        />
        <ShortcutHint />
        <span className="hidden sm:inline text-ink-mid">
          Signed in as <b className="text-ink">{username}</b>
        </span>
        <form action={logout}>
          <button type="submit" className="btn-secondary text-xs py-1.5 px-3">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
