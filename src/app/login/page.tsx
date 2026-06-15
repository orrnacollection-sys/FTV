import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await auth();
  // Only auto-redirect to /dashboard when the session id still resolves to a
  // real, active User row. A stale JWT (e.g. after a DB reseed) would otherwise
  // bounce the user into a redirect loop with requireAdmin.
  if (session?.user) {
    const id = (session.user as { id?: string }).id;
    if (id) {
      const row = await prisma.user.findUnique({ where: { id }, select: { id: true, isActive: true } });
      if (row?.isActive) redirect("/dashboard");
    }
  }
  const sp = await searchParams;

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[420px_1fr]">
      <aside className="hidden md:flex flex-col justify-between bg-brand-black p-10 text-white">
        <div>
          <div className="font-display text-2xl font-bold tracking-tight">Adwitiya FTV</div>
          <div className="text-[10px] uppercase tracking-[.14em] text-white/40 mt-1">
            Vendor & Inventory
          </div>
        </div>
        <div>
          <div className="font-display text-5xl leading-tight">
            Welcome <em className="not-italic text-brand-yellow">back.</em>
          </div>
          <p className="mt-4 max-w-sm text-sm text-white/55">
            Sign in to manage vendors, items, purchase orders, sales, and payments.
          </p>
        </div>
        <div className="text-xs text-white/30">© Adwitiya Global, Surajpur, Greater Noida</div>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="card w-full max-w-md p-8">
          <h1 className="font-display text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-ink-faint">Use your admin credentials.</p>
          {sp?.error === "session-stale" ? (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Your previous session is no longer valid (the database may have been reseeded). Please sign in again.
            </div>
          ) : sp?.error ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Invalid username or password.
            </div>
          ) : null}
          <div className="mt-6">
            <LoginForm next={sp?.next} />
          </div>
          <div className="mt-6 rounded border border-dashed border-brand-yellow-dark bg-brand-yellow-50 px-3 py-2 text-xs text-ink-mid">
            Demo: <b>ankur</b> / <b>ankur@123</b>
          </div>
          <div className="mt-4 text-center text-xs text-ink-faint">
            New vendor? <a href="/apply" className="font-bold text-brand-yellow-dark hover:underline">Apply to onboard →</a>
          </div>
        </div>
      </main>
    </div>
  );
}
