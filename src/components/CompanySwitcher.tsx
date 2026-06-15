"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, ChevronDown, Plus, Check } from "lucide-react";
import { switchActiveCompany } from "@/app/(admin)/companies/actions";

type Option = { id: string; brandName: string; legalName: string; isPrimary: boolean };

export function CompanySwitcher({
  companies,
  activeId,
}: {
  companies: Option[];
  activeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  const active = companies.find((c) => c.id === activeId) ?? companies[0];

  function pick(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await switchActiveCompany(id);
      setOpen(false);
      router.refresh();
    });
  }

  // Visually distinct tone for non-primary companies so the user always
  // knows when they're NOT on the primary book. Primary = neutral brand
  // yellow chip; non-primary = pink/magenta chip that's hard to miss.
  const isPrimary = active?.isPrimary ?? false;
  const chipTone = isPrimary
    ? "bg-brand-yellow text-ink-strong border-2 border-brand-yellow-dark"
    : "bg-rose-500 text-white border-2 border-rose-700 shadow-md ring-2 ring-rose-200";
  const labelTone = isPrimary ? "text-ink-strong/70" : "text-white/90";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 font-bold transition hover:brightness-105 ${chipTone}`}
        title="Switch active company"
        disabled={busy}
      >
        <Building2 className="h-4 w-4 shrink-0" />
        <div className="flex flex-col items-start leading-tight">
          <span className={`text-[9px] uppercase tracking-wider font-bold ${labelTone}`}>
            {isPrimary ? "Active Company" : "⚠ Not Primary — All Writes Land Here"}
          </span>
          <span className="text-sm font-bold whitespace-nowrap">{active?.brandName ?? "—"}</span>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-border bg-white shadow-xl">
            <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-ink-faint font-bold flex items-center justify-between">
              <span>Switch Active Company</span>
              <span className="text-ink-mid normal-case tracking-normal">{companies.length} accessible</span>
            </div>
            <div className="max-h-80 overflow-auto">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c.id)}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-brand-yellow-50/40 ${c.id === activeId ? "bg-brand-yellow-pale/40" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {c.id === activeId ? <Check className="h-3.5 w-3.5 text-brand-yellow" /> : <span className="w-3.5" />}
                    <div className="flex-1">
                      <div className="font-bold flex items-center gap-1.5">
                        {c.brandName}
                        {c.isPrimary && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">PRIMARY</span>}
                      </div>
                      <div className="text-ink-mid text-[10px]">{c.legalName}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t border-border px-1 py-1 flex gap-1">
              <Link
                href="/companies"
                onClick={() => setOpen(false)}
                className="flex-1 rounded px-2 py-1.5 text-center text-xs hover:bg-brand-yellow-50/40"
              >
                Manage…
              </Link>
              <Link
                href="/companies/new"
                onClick={() => setOpen(false)}
                className="flex-1 rounded bg-brand-yellow px-2 py-1.5 text-center text-xs font-bold text-ink-strong hover:brightness-105 flex items-center justify-center gap-1"
              >
                <Plus className="h-3 w-3" /> New
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
