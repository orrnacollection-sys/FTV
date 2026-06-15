"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { useFieldFlow } from "@/hooks/useFieldFlow";
import { Kbd } from "@/components/Kbd";
import { toast } from "@/components/Toast";
import { updateLedger } from "../actions";

const TYPES = [
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "EQUITY", label: "Equity" },
];

const SUBTYPES: Record<string, string[]> = {
  ASSET: ["CURRENT_ASSET", "FIXED_ASSET"],
  LIABILITY: ["CURRENT_LIABILITY", "LONG_TERM_LIABILITY"],
  INCOME: ["OPERATING_INCOME", "OTHER_INCOME"],
  EXPENSE: ["COGS", "OPERATING_EXPENSE", "OTHER_EXPENSE"],
  EQUITY: ["CAPITAL", "RETAINED_EARNINGS"],
};

type Parent = { id: string; code: string | null; name: string; type: string };

type Account = {
  id: string;
  code: string | null;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
  openingAmount: number;
  openingType: string;
  isActive: boolean;
  isSystem: boolean;
  isLinked: boolean;
  linkKind: string | null;
  linkLabel: string | null;
};

export function EditLedgerForm({
  mode,
  parents,
  account,
}: {
  mode: string;
  parents: Parent[];
  account: Account;
}) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [type, setType] = useState(account.type);
  const [subType, setSubType] = useState(account.subType ?? "");
  const [parentId, setParentId] = useState(account.parentId ?? "");
  const [openingType, setOpeningType] = useState(account.openingType);

  useUnsavedChanges(dirty, () => router.push("/accounting/chart"));
  const { onKeyDown, formRef } = useFieldFlow();
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), { label: "Save ledger", group: "Form" });

  const codeEditable = mode === "MANUAL" && !account.isSystem && !account.isLinked;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    setTopError(null);
    start(async () => {
      const r = await updateLedger(fd);
      if (r && "ok" in r && r.ok) {
        toast.success("Ledger updated");
        setDirty(false);
        router.push("/accounting/chart");
      } else {
        setErrors(r.fieldErrors ?? {});
        setTopError(r.error);
      }
    });
  };

  const parentOptions = parents.filter((p) => p.type === type);

  return (
    <form ref={formRef} onSubmit={onSubmit} onKeyDown={onKeyDown} onChange={() => setDirty(true)} className="space-y-5 kbd-flow">
      <input type="hidden" name="id" value={account.id} />
      {topError && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{topError}</div>}

      {(account.isSystem || account.isLinked) && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {account.isLinked
            ? <>This is an auto-linked {account.linkKind} sub-ledger{account.linkLabel ? ` (${account.linkLabel})` : ""}. You can edit it here, but its name is normally driven by the {account.linkKind} master.</>
            : <>This is a system-seeded account. You can rename it and set its opening, but its code is fixed and it can&apos;t be deleted.</>}
        </div>
      )}

      <div>
        <label className="label" htmlFor="name">Ledger Name<span className="text-red-600">*</span></label>
        <input id="name" name="name" required defaultValue={account.name} className="input mt-1" placeholder="e.g. Packing Charges" />
        {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="type">Group<span className="text-red-600">*</span></label>
          <select id="type" name="type" value={type} onChange={(e) => { setType(e.target.value); setParentId(""); setDirty(true); }} className="input mt-1">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {errors.type && <div className="mt-1 text-[11px] text-red-700">{errors.type}</div>}
        </div>
        <div>
          <label className="label" htmlFor="subType">Sub-group</label>
          <select id="subType" name="subType" value={subType} onChange={(e) => { setSubType(e.target.value); setDirty(true); }} className="input mt-1">
            <option value="">—</option>
            {(SUBTYPES[type] ?? []).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="parentId">Under (parent group)</label>
        <select id="parentId" name="parentId" value={parentId} onChange={(e) => { setParentId(e.target.value); setDirty(true); }} className="input mt-1">
          <option value="">— Top level —</option>
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.code ? p.code + " · " : ""}{p.name}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-ink-faint">Optional — nest under an existing {type.toLowerCase()} group.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="code">Code</label>
          {codeEditable ? (
            <>
              <input id="code" name="code" defaultValue={account.code ?? ""} className="input mt-1 font-mono uppercase" placeholder="e.g. 5215" autoCapitalize="characters" />
              <p className="mt-1 text-[11px] text-ink-faint">Manual coding — must be unique.</p>
              {errors.code && <div className="mt-1 text-[11px] text-red-700">{errors.code}</div>}
            </>
          ) : (
            <>
              <input id="code" value={account.code ?? "—"} readOnly className="input mt-1 bg-surface-gray-100 font-mono" />
              <p className="mt-1 text-[11px] text-ink-faint">Code is fixed for this account.</p>
            </>
          )}
        </div>
        <div>
          <label className="label" htmlFor="openingBalance">Opening Balance (₹)</label>
          <div className="mt-1 flex gap-2">
            <input id="openingBalance" name="openingBalance" type="number" step="0.01" min="0" defaultValue={account.openingAmount} className="input flex-1 font-mono" />
            <select name="openingType" value={openingType} onChange={(e) => { setOpeningType(e.target.value); setDirty(true); }} className="input max-w-[80px]">
              <option value="DR">Dr</option>
              <option value="CR">Cr</option>
            </select>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">Carried-forward balance — flows into the Trial Balance &amp; Balance Sheet.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={account.isActive} className="accent-brand-yellow-dark" />
        Active
      </label>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push("/accounting/chart")} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save changes"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">Esc to discard.</span>
      </div>
    </form>
  );
}
