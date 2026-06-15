"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "react-hot-toast";
import { INDIAN_STATES } from "@/lib/constants";
import { createCompany } from "./actions";

export function CompanyForm() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [errs, setErrs] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrs({});
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createCompany(fd);
      if (!("ok" in r) || !r.ok) {
        if ("fieldErrors" in r && r.fieldErrors) setErrs(r.fieldErrors);
        toast.error("error" in r ? r.error : "Create failed");
        return;
      }
      toast.success("Company created · switched to new company");
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card max-w-3xl">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">
        Company Details
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Legal Name *" err={errs.legalName} className="sm:col-span-2">
          <input name="legalName" className="input" placeholder="e.g. Adwitiya Global Pvt Ltd" required />
        </Field>
        <Field label="Brand Name">
          <input name="brandName" className="input" placeholder="Short display name" />
        </Field>
        <Field label="State" err={errs.state}>
          <select name="state" className="input" defaultValue="">
            <option value="">— Select state —</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="GSTIN (auto-creates default registration)" className="sm:col-span-2">
          <input name="gstin" className="input font-mono" placeholder="15-char GSTIN (optional)" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input name="address" className="input" />
        </Field>
        <Field label="City">
          <input name="city" className="input" />
        </Field>
        <Field label="Pincode">
          <input name="pincode" className="input" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className="input" />
        </Field>
        <Field label="Mobile">
          <input name="mobile" className="input" />
        </Field>
      </div>
      <div className="border-t border-border bg-paper-cream/60 px-4 py-3 flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating + seeding…" : "Create Company + Switch"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, err, className = "", children }: { label: string; err?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">{label}</span>
      {children}
      {err ? <span className="block text-xs text-rose-600 mt-1">{err}</span> : null}
    </label>
  );
}
