import { ApplyWizard } from "./ApplyWizard";

const steps = [
  { num: 1, label: "Email", sub: "Verify with OTP" },
  { num: 2, label: "Business", sub: "Name, GST, address" },
  { num: 3, label: "Contact", sub: "Person, mobile" },
  { num: 4, label: "Catalog", sub: "What you sell" },
  { num: 5, label: "Bank & Docs", sub: "Account + uploads" },
  { num: 6, label: "Review", sub: "Submit application" },
];

export default function ApplyPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[400px_1fr]">
      <aside className="hidden md:flex flex-col justify-between bg-brand-black p-10 text-white">
        <div>
          <div className="font-display text-2xl font-bold">Adwitiya FTV</div>
          <div className="text-[10px] uppercase tracking-[.14em] text-white/40 mt-1">Vendor Onboarding</div>
        </div>
        <div>
          <div className="font-display text-5xl leading-tight">
            Partner <em className="not-italic text-brand-yellow">with us.</em>
          </div>
          <p className="mt-4 max-w-sm text-sm text-white/55">
            Apply to onboard as a vendor. We review every application within 2 business days.
          </p>
          <ol className="mt-8 space-y-3">
            {steps.map((s) => (
              <li key={s.num} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border border-brand-yellow/40 bg-brand-yellow/15 text-[10px] font-bold text-brand-yellow">
                  {s.num}
                </span>
                <span>
                  <div className="text-sm font-semibold text-white/85">{s.label}</div>
                  <div className="text-[11px] text-white/40">{s.sub}</div>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="text-xs text-white/30">© Adwitiya Global, Surajpur, Greater Noida</div>
      </aside>

      <main className="flex justify-center px-6 py-12 animate-in fade-in duration-300">
        <div className="w-full max-w-2xl">
          <ApplyWizard />
        </div>
      </main>
    </div>
  );
}
