"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { COUNTRIES, DEFAULT_COUNTRY, INDIAN_STATES } from "@/lib/constants";
import { updateCompany } from "./actions";

type Initial = {
  legalName: string;
  brandName: string;
  pan: string | null;
  tan: string | null;
  cin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  email: string | null;
  mobile: string | null;
  website: string | null;
  logoUrl: string | null;
  baseCurrency: string;
  fyStartMonth: number;
  bankName: string | null;
  accountNo: string | null;
  ifsc: string | null;
};

const FY_MONTHS = [
  { val: 1, label: "January" }, { val: 2, label: "February" }, { val: 3, label: "March" },
  { val: 4, label: "April" }, { val: 5, label: "May" }, { val: 6, label: "June" },
  { val: 7, label: "July" }, { val: 8, label: "August" }, { val: 9, label: "September" },
  { val: 10, label: "October" }, { val: 11, label: "November" }, { val: 12, label: "December" },
];

export function CompanyProfileEditor({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await updateCompany(fd);
      if ("error" in res) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
      toast.success("Company profile saved");
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Identity</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Legal Name<span className="text-red-600">*</span></label>
            <input name="legalName" defaultValue={initial.legalName} required className="input mt-1" />
            {errors.legalName && <div className="mt-1 text-[11px] text-red-700">{errors.legalName}</div>}
          </div>
          <div>
            <label className="label">Brand / Short Name<span className="text-red-600">*</span></label>
            <input name="brandName" defaultValue={initial.brandName} required className="input mt-1" />
            {errors.brandName && <div className="mt-1 text-[11px] text-red-700">{errors.brandName}</div>}
          </div>
          <div>
            <label className="label">PAN</label>
            <input name="pan" defaultValue={initial.pan ?? ""} placeholder="AAAAA0000A" maxLength={10} className="input mt-1 font-mono uppercase" />
            {errors.pan && <div className="mt-1 text-[11px] text-red-700">{errors.pan}</div>}
          </div>
          <div>
            <label className="label">TAN (TDS)</label>
            <input name="tan" defaultValue={initial.tan ?? ""} placeholder="AAAA00000A" maxLength={10} className="input mt-1 font-mono uppercase" />
            {errors.tan && <div className="mt-1 text-[11px] text-red-700">{errors.tan}</div>}
          </div>
          <div>
            <label className="label">CIN (Corporate)</label>
            <input name="cin" defaultValue={initial.cin ?? ""} maxLength={21} className="input mt-1 font-mono uppercase" />
            {errors.cin && <div className="mt-1 text-[11px] text-red-700">{errors.cin}</div>}
          </div>
          <div>
            <label className="label">Logo URL</label>
            <input name="logoUrl" defaultValue={initial.logoUrl ?? ""} placeholder="https://…" className="input mt-1" />
            {errors.logoUrl && <div className="mt-1 text-[11px] text-red-700">{errors.logoUrl}</div>}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Registered address (PPOB)</div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">Street / Line 1</label>
            <textarea name="address" defaultValue={initial.address ?? ""} className="input mt-1 min-h-[70px]" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">City</label>
              <input name="city" defaultValue={initial.city ?? ""} className="input mt-1" />
              {errors.city && <div className="mt-1 text-[11px] text-red-700">{errors.city}</div>}
            </div>
            <div>
              <label className="label">State</label>
              <select name="state" defaultValue={initial.state ?? ""} className="input mt-1">
                <option value="">—</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.state && <div className="mt-1 text-[11px] text-red-700">{errors.state}</div>}
            </div>
            <div>
              <label className="label">Pincode</label>
              <input name="pincode" defaultValue={initial.pincode ?? ""} inputMode="numeric" maxLength={6} pattern="[1-9][0-9]{5}" className="input mt-1 font-mono" />
              {errors.pincode && <div className="mt-1 text-[11px] text-red-700">{errors.pincode}</div>}
            </div>
            <div>
              <label className="label">Country</label>
              <select name="country" defaultValue={initial.country ?? DEFAULT_COUNTRY} className="input mt-1">
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Contact</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" defaultValue={initial.email ?? ""} className="input mt-1" />
            {errors.email && <div className="mt-1 text-[11px] text-red-700">{errors.email}</div>}
          </div>
          <div>
            <label className="label">Mobile</label>
            <input name="mobile" defaultValue={initial.mobile ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label">Website</label>
            <input name="website" defaultValue={initial.website ?? ""} placeholder="https://…" className="input mt-1" />
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Financial</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Reporting Currency</label>
            <input name="baseCurrency" defaultValue={initial.baseCurrency} maxLength={3} className="input mt-1 font-mono uppercase" />
            <p className="mt-1 text-[11px] text-ink-faint">ISO 4217 code. INR today; multi-currency lands later.</p>
          </div>
          <div>
            <label className="label">Financial Year Start</label>
            <select name="fyStartMonth" defaultValue={String(initial.fyStartMonth)} className="input mt-1">
              {FY_MONTHS.map((m) => <option key={m.val} value={m.val}>{m.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-ink-faint">India uses April. Calendar-year geographies use January.</p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Default bank (for customer receivables)</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Bank Name</label>
            <input name="bankName" defaultValue={initial.bankName ?? ""} className="input mt-1" />
          </div>
          <div>
            <label className="label">Account Number</label>
            <input name="accountNo" defaultValue={initial.accountNo ?? ""} className="input mt-1 font-mono" />
            {errors.accountNo && <div className="mt-1 text-[11px] text-red-700">{errors.accountNo}</div>}
          </div>
          <div>
            <label className="label">IFSC</label>
            <input name="ifsc" defaultValue={initial.ifsc ?? ""} placeholder="HDFC0001234" className="input mt-1 font-mono uppercase" />
            {errors.ifsc && <div className="mt-1 text-[11px] text-red-700">{errors.ifsc}</div>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save company profile"}
        </button>
        <span className="text-[11px] text-ink-faint">Cached for 5 min — refresh to see PDF updates immediately.</span>
      </div>
    </form>
  );
}
