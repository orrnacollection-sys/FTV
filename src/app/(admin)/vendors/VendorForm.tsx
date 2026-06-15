"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { useFieldFlow } from "@/hooks/useFieldFlow";
import { Kbd } from "@/components/Kbd";
import { createVendor, updateVendor } from "./actions";
import { VENDOR_STATUSES, INDIAN_STATES, COUNTRIES, DEFAULT_COUNTRY, GST_REG_TYPES, GST_REG_TYPE_LABELS } from "@/lib/constants";

type Vendor = {
  id?: string;
  code: string | null;
  name: string;
  email: string | null;
  whatsapp: string | null;
  gst: string | null;
  gstRegType: string;
  pan: string | null;
  ifsc: string | null;
  bankName: string | null;
  accountNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  staleDays: number | null;
  status: string;
  /** Signed opening balance from the vendor's CoA sub-ledger (Cr-positive). */
  opening?: number | null;
};

export function VendorForm({ initial }: { initial?: Vendor }) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initial?.name ?? "");
  // Opening balance shown as magnitude + Dr/Cr (vendor's natural side is Cr).
  const initOpen = initial?.opening ?? 0;
  const openAmt = initOpen ? String(Math.abs(initOpen)) : "";
  const openType = initOpen < 0 ? "DR" : "CR";

  useUnsavedChanges(dirty, () => router.push("/vendors"));

  // Tally-style field flow: cursor opens on the first field, Enter walks to the
  // next, and the last field saves. The same formRef drives mod+enter submit.
  const { onKeyDown: onFieldFlowKeyDown, formRef } = useFieldFlow();
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: editing ? "Update vendor" : "Create vendor",
    group: "Form",
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    setTopError(null);
    startTransition(async () => {
      const result = editing
        ? await updateVendor(initial!.id!, fd)
        : await createVendor(fd);
      if (result && "ok" in result && result.ok === false) {
        setErrors(result.fieldErrors ?? {});
        setTopError(result.error);
      } else {
        setDirty(false);
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} onKeyDown={onFieldFlowKeyDown} onChange={() => setDirty(true)} className="space-y-6 kbd-flow">
      {topError ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{topError}</div>
      ) : null}

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Identity</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Vendor Name<span className="text-red-600">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className="input mt-1"
            />
            {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
          </div>
          <div>
            <label className="label" htmlFor="code">Vendor Code</label>
            <input
              id="code"
              name="code"
              type="text"
              defaultValue={initial?.code ?? ""}
              placeholder="e.g. ANOK"
              maxLength={20}
              autoCapitalize="characters"
              className="input mt-1 font-mono uppercase tracking-wide"
            />
            <p className="mt-1 text-[11px] text-ink-faint">Letters, digits and &ldquo;-&rdquo; only. Optional, but must be unique if set.</p>
            {errors.code && <div className="mt-1 text-[11px] text-red-700">{errors.code}</div>}
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} className="input mt-1" />
            {errors.email && <div className="mt-1 text-[11px] text-red-700">{errors.email}</div>}
          </div>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" name="whatsapp" defaultValue={initial?.whatsapp ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="gst">GST</label>
            <input id="gst" name="gst" defaultValue={initial?.gst ?? ""} placeholder="09AAAAA0000A1Z5" className="input mt-1 font-mono" />
            {errors.gst && <div className="mt-1 text-[11px] text-red-700">{errors.gst}</div>}
          </div>
          <div>
            <label className="label" htmlFor="gstRegType">GST Registration Type</label>
            <select id="gstRegType" name="gstRegType" defaultValue={initial?.gstRegType ?? "UNREGISTERED"} className="input mt-1">
              {GST_REG_TYPES.map((t) => (
                <option key={t} value={t}>{GST_REG_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-faint">COMPOSITION vendors don&apos;t issue ITC-eligible invoices. UNREGISTERED may trigger RCM.</p>
            {errors.gstRegType && <div className="mt-1 text-[11px] text-red-700">{errors.gstRegType}</div>}
          </div>
          <div>
            <label className="label" htmlFor="pan">PAN</label>
            <input id="pan" name="pan" defaultValue={initial?.pan ?? ""} placeholder="AAAAA0000A" className="input mt-1 font-mono" />
            {errors.pan && <div className="mt-1 text-[11px] text-red-700">{errors.pan}</div>}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Bank</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ifsc">IFSC</label>
            <input id="ifsc" name="ifsc" defaultValue={initial?.ifsc ?? ""} placeholder="HDFC0001234" className="input mt-1 font-mono" />
            {errors.ifsc && <div className="mt-1 text-[11px] text-red-700">{errors.ifsc}</div>}
          </div>
          <div>
            <label className="label" htmlFor="bankName">Bank Name</label>
            <input id="bankName" name="bankName" defaultValue={initial?.bankName ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="accountNo">Account Number</label>
            <input id="accountNo" name="accountNo" defaultValue={initial?.accountNo ?? ""} className="input mt-1 font-mono" />
            {errors.accountNo && <div className="mt-1 text-[11px] text-red-700">{errors.accountNo}</div>}
          </div>
          <div>
            <label className="label" htmlFor="staleDays">Stale-stock window (days)</label>
            <input id="staleDays" name="staleDays" type="number" min="1" step="1" defaultValue={initial?.staleDays ?? ""} placeholder="120" className="input mt-1" />
            <p className="mt-1 text-[11px] text-ink-faint">Empty = default 120. Used by the Stale Stock report to flag unsold inventory.</p>
            {errors.staleDays && <div className="mt-1 text-[11px] text-red-700">{errors.staleDays}</div>}
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            {initial ? (
              <>
                <select id="status" name="status" defaultValue={initial.status} className="input mt-1">
                  {VENDOR_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {initial.status === "PENDING" && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Pending vendor — approve on the review screen, not by switching here.
                  </p>
                )}
              </>
            ) : (
              <>
                <input type="hidden" name="status" value="PENDING" />
                <div className="mt-1 rounded border-[1.5px] border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  New vendors land in <strong>PENDING</strong> — you&apos;ll go to the review screen next to approve and send the portal invite.
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Opening Balance</div>
        <div className="max-w-xs">
          <label className="label" htmlFor="openingBalance">Carried-forward balance (₹)</label>
          <div className="mt-1 flex gap-2">
            <input id="openingBalance" name="openingBalance" type="number" step="0.01" min="0" defaultValue={openAmt} className="input flex-1 font-mono" />
            <select name="openingType" defaultValue={openType} className="input max-w-[80px]">
              <option value="CR">Cr</option>
              <option value="DR">Dr</option>
            </select>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            What you already owe this vendor at go-live (Cr). Posts to their Sundry Creditors sub-ledger and shows in the Trial Balance / Balance Sheet.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Address</div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label" htmlFor="address">Street / Line 1</label>
            <textarea
              id="address"
              name="address"
              defaultValue={initial?.address ?? ""}
              className="input mt-1 min-h-[80px]"
              placeholder="Shop / building / street"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="city">City</label>
              <input id="city" name="city" defaultValue={initial?.city ?? ""} className="input mt-1" placeholder="e.g. Greater Noida" />
              {errors.city && <div className="mt-1 text-[11px] text-red-700">{errors.city}</div>}
            </div>
            <div>
              <label className="label" htmlFor="state">State</label>
              <select id="state" name="state" defaultValue={initial?.state ?? ""} className="input mt-1">
                <option value="">—</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {errors.state && <div className="mt-1 text-[11px] text-red-700">{errors.state}</div>}
            </div>
            <div>
              <label className="label" htmlFor="pincode">Pincode</label>
              <input
                id="pincode"
                name="pincode"
                defaultValue={initial?.pincode ?? ""}
                inputMode="numeric"
                maxLength={6}
                pattern="[1-9][0-9]{5}"
                className="input mt-1 font-mono"
                placeholder="201310"
              />
              {errors.pincode && <div className="mt-1 text-[11px] text-red-700">{errors.pincode}</div>}
            </div>
            <div>
              <label className="label" htmlFor="country">Country</label>
              <select id="country" name="country" defaultValue={initial?.country ?? DEFAULT_COUNTRY} className="input mt-1">
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {errors.country && <div className="mt-1 text-[11px] text-red-700">{errors.country}</div>}
            </div>
          </div>
          <p className="text-[11px] text-ink-faint">State drives IGST vs CGST+SGST split. Pincode powers shipping pickups. Country defaults to India.</p>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push("/vendors")} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : editing ? "Update vendor" : "Create vendor"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">Press Esc to discard changes.</span>
      </div>
    </form>
  );
}
