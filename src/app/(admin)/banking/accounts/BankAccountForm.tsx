"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "react-hot-toast";
import { BANK_TYPES } from "@/lib/validators/banking";
import { createBankAccount, updateBankAccount } from "../actions";

type FormState = {
  name: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  type: string;
  currency: string;
  openingBalance: number;
  openingAsOf: string;
  notes: string;
  isActive: boolean;
};

const EMPTY: FormState = {
  name: "",
  bankName: "",
  accountNo: "",
  ifsc: "",
  branch: "",
  type: "CURRENT",
  currency: "INR",
  openingBalance: 0,
  openingAsOf: "",
  notes: "",
  isActive: true,
};

type Props =
  | { mode: "create" }
  | { mode: "edit"; bankId: string; initial: FormState };

export function BankAccountForm(props: Props) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(
    props.mode === "edit" ? props.initial : EMPTY,
  );
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, startTransition] = useTransition();

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrs({});
    const fd = new FormData(e.currentTarget);
    if (state.isActive) fd.set("isActive", "true");
    else fd.delete("isActive");

    startTransition(async () => {
      const r =
        props.mode === "create"
          ? await createBankAccount(fd)
          : await updateBankAccount(props.bankId, fd);
      if ("error" in r && r.error) {
        if (r.fieldErrors) setErrs(r.fieldErrors);
        toast.error(r.error);
        return;
      }
      toast.success(props.mode === "create" ? "Bank account created" : "Saved");
      router.push("/banking/accounts");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card max-w-3xl">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 text-sm font-bold">
        Account Details
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Display Name *" err={errs.name}>
          <input
            name="name"
            className="input"
            value={state.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. HDFC Current — 1234"
            required
          />
        </Field>
        <Field label="Type *">
          <select
            name="type"
            className="input"
            value={state.type}
            onChange={(e) => set("type", e.target.value)}
          >
            {BANK_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        <Field label="Bank Name *" err={errs.bankName}>
          <input
            name="bankName"
            className="input"
            value={state.bankName}
            onChange={(e) => set("bankName", e.target.value)}
            placeholder="HDFC Bank"
            required
          />
        </Field>
        <Field label="Account No *" err={errs.accountNo}>
          <input
            name="accountNo"
            className="input"
            value={state.accountNo}
            onChange={(e) => set("accountNo", e.target.value)}
            placeholder="50100123456789"
            required
          />
        </Field>

        <Field label="IFSC">
          <input
            name="ifsc"
            className="input font-mono"
            value={state.ifsc}
            onChange={(e) => set("ifsc", e.target.value.toUpperCase())}
            placeholder="HDFC0001234"
          />
        </Field>
        <Field label="Branch">
          <input
            name="branch"
            className="input"
            value={state.branch}
            onChange={(e) => set("branch", e.target.value)}
            placeholder="Surajpur"
          />
        </Field>

        <Field label="Currency">
          <input
            name="currency"
            className="input"
            value={state.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
            placeholder="INR"
          />
        </Field>
        <Field label="Opening Balance ₹">
          <input
            name="openingBalance"
            type="number"
            step="0.01"
            className="input text-right font-mono"
            value={state.openingBalance}
            onChange={(e) => set("openingBalance", Number(e.target.value))}
          />
        </Field>

        <Field label="Opening as of (DD-MM-YYYY)">
          <input
            name="openingAsOf"
            className="input"
            value={state.openingAsOf}
            onChange={(e) => set("openingAsOf", e.target.value)}
            placeholder="01-04-2026"
          />
        </Field>
        <Field label="Active">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              checked={state.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            <span>Show this account in pickers + reports</span>
          </label>
        </Field>

        <Field label="Notes" className="sm:col-span-2">
          <textarea
            name="notes"
            className="input"
            rows={2}
            value={state.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Optional — internal note"
          />
        </Field>
      </div>

      <div className="border-t border-border bg-paper-cream/60 px-4 py-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => router.back()}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : props.mode === "create" ? "Create Account" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  err,
  className = "",
  children,
}: {
  label: string;
  err?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">{label}</span>
      {children}
      {err ? <span className="block text-xs text-rose-600 mt-1">{err}</span> : null}
    </label>
  );
}
