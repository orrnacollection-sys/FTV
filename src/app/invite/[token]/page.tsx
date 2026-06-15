import { prisma } from "@/lib/db";
import { AcceptInviteForm } from "./AcceptInviteForm";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import Link from "next/link";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.vendorInvite.findUnique({
    where: { token },
    include: { vendor: { select: { code: true, name: true } } },
  });

  // Collapse all failure modes (missing / expired / used) into one generic
  // message — don't reveal which token state someone hit.
  const isInvalid = !invite || invite.expiresAt < new Date() || !!invite.acceptedAt;

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[420px_1fr]">
      <aside className="hidden md:flex flex-col justify-between bg-brand-black p-10 text-white">
        <div>
          <div className="font-display text-2xl font-bold">Adwitiya FTV</div>
          <div className="text-[10px] uppercase tracking-[.14em] text-white/40 mt-1">Vendor & Inventory</div>
        </div>
        <div>
          <div className="font-display text-5xl leading-tight">
            You&apos;re <em className="not-italic text-brand-yellow">invited.</em>
          </div>
          <p className="mt-4 max-w-sm text-sm text-white/55">
            Set your username and password to activate your account.
          </p>
        </div>
        <div className="text-xs text-white/30">© Adwitiya Global, Surajpur, Greater Noida</div>
      </aside>

      <main className="flex items-center justify-center px-6 py-12 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="card w-full max-w-md p-8">
          {isInvalid || !invite ? (
            <>
              <h1 className="font-display text-2xl font-bold">Invite unavailable</h1>
              <p className="mt-2 text-sm text-ink-faint">
                This invite link is no longer valid. Ask whoever invited you to send a new one.
              </p>
              <Link href="/login" className="btn-secondary mt-6 inline-flex">Go to sign in</Link>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold">Accept invite</h1>
              <div className="mt-2 text-sm text-ink-faint">
                For <b>{invite.email}</b> as{" "}
                <span className="badge border-brand-yellow-light bg-brand-yellow-50">
                  {ROLE_LABELS[invite.role as Role]}
                </span>
                {invite.vendor && (
                  <> at <b>{invite.vendor.code} · {invite.vendor.name}</b></>
                )}
              </div>
              <div className="mt-6">
                <AcceptInviteForm token={token} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
