"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";
import { createCustomer, updateCustomer } from "./actions";
import {
  CUSTOMER_STATUSES,
  PRICE_TIERS,
  PRICE_TIER_LABELS,
  INDIAN_STATES,
  COUNTRIES,
  DEFAULT_COUNTRY,
  GST_REG_TYPES,
  GST_REG_TYPE_LABELS,
} from "@/lib/constants";

type Customer = {
  id?: string;
  code: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  whatsapp: string | null;
  gst: string | null;
  gstRegType: string;
  pan: string | null;
  bankName: string | null;
  accountNo: string | null;
  ifsc: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  priceTier: string;
  creditLimit: number | null;
  paymentTermsDays: number;
  salesRep: string | null;
  status: string;
  /** Signed opening balance from the customer's CoA sub-ledger (Dr-positive). */
  opening?: number | null;
};

export function CustomerForm({ initial }: { initial?: Customer }) {
  const router = useRouter();
  const editing = !!initial?.id;
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Opening balance shown as magnitude + Dr/Cr (customer's natural side is Dr).
  const initOpen = initial?.opening ?? 0;
  const openAmt = initOpen ? String(Math.abs(initOpen)) : "";
  const openType = initOpen < 0 ? "CR" : "DR";

  useUnsavedChanges(dirty, () => router.push("/customers"));

  const formRef = useRef<HTMLFormElement>(null);
  useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
    label: editing ? "Update customer" : "Create customer",
    group: "Form",
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    setTopError(null);
    startTransition(async () => {
      const result = editing
        ? await updateCustomer(initial!.id!, fd)
        : await createCustomer(fd);
      if (result && "ok" in result && result.ok === false) {
        setErrors(result.fieldErrors ?? {});
        setTopError(result.error);
      } else {
        setDirty(false);
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={() => setDirty(true)} className="space-y-6">
      {topError ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{topError}</div>
      ) : null}

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Identity</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Customer Name<span className="text-red-600">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={initial?.name ?? ""}
              className="input mt-1"
            />
            {errors.name && <div className="mt-1 text-[11px] text-red-700">{errors.name}</div>}
          </div>
          <div>
            <label className="label" htmlFor="code">Customer Code</label>
            <input
              id="code"
              name="code"
              type="text"
              defaultValue={initial?.code ?? ""}
              placeholder="e.g. WST-001"
              maxLength={20}
              autoCapitalize="characters"
              className="input mt-1 font-mono uppercase tracking-wide"
            />
            <p className="mt-1 text-[11px] text-ink-faint">Optional. Letters, digits and &ldquo;-&rdquo; only.</p>
            {errors.code && <div className="mt-1 text-[11px] text-red-700">{errors.code}</div>}
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} className="input mt-1" />
            {errors.email && <div className="mt-1 text-[11px] text-red-700">{errors.email}</div>}
          </div>
          <div>
            <label className="label" htmlFor="mobile">Mobile</label>
            <input id="mobile" name="mobile" defaultValue={initial?.mobile ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" name="whatsapp" defaultValue={initial?.whatsapp ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label" htmlFor="gst">GST</label>
            <input id="gst" name="gst" defaultValue={initial?.gst ?? ""} placeholder="27AAAAA0000A1Z5" className="input mt-1 font-mono" />
            {errors.gst && <div className="mt-1 text-[11px] text-red-700">{errors.gst}</div>}
          </div>
          <div>
            <label className="label" htmlFor="gstRegType">GST Registration Type</label>
            <select id="gstRegType" name="gstRegType" defaultValue={initial?.gstRegType ?? "UNREGISTERED"} className="input mt-1">
              {GST_REG_TYPES.map((t) => (
                <option key={t} value={t}>{GST_REG_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-faint">Drives B2B vs B2C classification on GSTR-1.</p>
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
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Commercials</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="priceTier">Price Tier</label>
            <select id="priceTier" name="priceTier" defaultValue={initial?.priceTier ?? "RETAIL"} className="input mt-1">
              {PRICE_TIERS.map((t) => (
                <option key={t} value={t}>{PRICE_TIER_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-faint">Drives the per-SKU rate later (Tax Master / Price Book).</p>
          </div>
          <div>
            <label className="label" htmlFor="creditLimit">Credit Limit (₹)</label>
            <input
              id="creditLimit"
              name="creditLimit"
              type="number"
              min="0"
              step="0.01"
              defaultValue={initial?.creditLimit ?? ""}
              placeholder="50000"
              className="input mt-1"
            />
            <p className="mt-1 text-[11px] text-ink-faint">Empty = no cap. Sales blocked when outstanding exceeds this.</p>
          </div>
          <div>
            <label className="label" htmlFor="paymentTermsDays">Payment Terms (days)</label>
            <input
              id="paymentTermsDays"
              name="paymentTermsDays"
              type="number"
              min="0"
              step="1"
              defaultValue={initial?.paymentTermsDays ?? 0}
              placeholder="30"
              className="input mt-1"
            />
            <p className="mt-1 text-[11px] text-ink-faint">0 = COD. Common: 30 (Net 30), 60 (Net 60).</p>
          </div>
          <div>
            <label className="label" htmlFor="salesRep">Sales Rep</label>
            <input
              id="salesRep"
              name="salesRep"
              defaultValue={initial?.salesRep ?? ""}
              placeholder="Account manager name"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={initial?.status ?? "ACTIVE"} className="input mt-1">
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-faint">SUSPENDED = credit hold (no new invoices).</p>
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
              <option value="DR">Dr</option>
              <option value="CR">Cr</option>
            </select>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            What this customer already owes you at go-live (Dr). Posts to their Sundry Debtors sub-ledger and shows in the Trial Balance / Balance Sheet.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Bank (for refunds)</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <label className="label" htmlFor="ifsc">IFSC</label>
            <input id="ifsc" name="ifsc" defaultValue={initial?.ifsc ?? ""} placeholder="HDFC0001234" className="input mt-1 font-mono" />
            {errors.ifsc && <div className="mt-1 text-[11px] text-red-700">{errors.ifsc}</div>}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Optional. Used when refunding money to the customer (returns, cancellations).</p>
      </section>

      <section>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Billing Address</div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label" htmlFor="address">Street / Line 1</label>
            <textarea id="address" name="address" defaultValue={initial?.address ?? ""} className="input mt-1 min-h-[80px]" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="city">City</label>
              <input id="city" name="city" defaultValue={initial?.city ?? ""} className="input mt-1" placeholder="e.g. Mumbai" />
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
                placeholder="400001"
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
          <p className="text-[11px] text-ink-faint">Billing state drives IGST vs CGST+SGST on the customer&apos;s invoices.</p>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={() => router.push("/customers")} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : editing ? "Update customer" : "Create customer"} <Kbd chord="mod+enter" className="ml-1" />
        </button>
        <span className="text-[11px] text-ink-faint">Press Esc to discard changes.</span>
      </div>
    </form>
  );
}
