"use client";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { ChevronLeft, ChevronRight, CheckCircle2, Loader2, Upload, FileText } from "lucide-react";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
} from "@/lib/validators/application";

type Form = {
  email: string;
  otpCode: string;
  otpVerified: boolean;

  name: string;
  businessType: string;
  yearsInBusiness: string;
  gst: string;
  pan: string;
  address: string;

  contactName: string;
  designation: string;
  whatsapp: string;
  website: string;
  referralSource: string;

  productCategoryHint: string;
  productCountRange: string;
  priceRange: string;
  catalogLink: string;
  samplesLink: string;
  applicationNotes: string;

  bankName: string;
  accountNo: string;
  accountNoConfirm: string;
  ifsc: string;
  accountType: string;
  branch: string;

  gstCertUrl: string;
  chequeUrl: string;
  consent: boolean;
};

const initialForm: Form = {
  email: "",
  otpCode: "",
  otpVerified: false,
  name: "",
  businessType: "",
  yearsInBusiness: "",
  gst: "",
  pan: "",
  address: "",
  contactName: "",
  designation: "",
  whatsapp: "",
  website: "",
  referralSource: "",
  productCategoryHint: "",
  productCountRange: "",
  priceRange: "",
  catalogLink: "",
  samplesLink: "",
  applicationNotes: "",
  bankName: "",
  accountNo: "",
  accountNoConfirm: "",
  ifsc: "",
  accountType: "CURRENT",
  branch: "",
  gstCertUrl: "",
  chequeUrl: "",
  consent: false,
};

type Step = 1 | 2 | 3 | 4 | 5 | 6;

export function ApplyWizard() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<Form>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState<{ message: string } | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ── Step actions ─────────────────────────────────────────────────────────

  const sendOtp = () => {
    if (!form.email) { setErrors({ email: "Email required" }); return; }
    startTransition(async () => {
      const r = await fetch("/api/onboarding/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) { toast.error(json.error ?? "Failed to send code"); return; }
      toast.success("Code sent — check your email");
    });
  };

  const verifyOtp = () => {
    if (form.otpCode.length !== 6) { setErrors({ otpCode: "Enter the 6-digit code" }); return; }
    startTransition(async () => {
      const r = await fetch("/api/onboarding/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, code: form.otpCode }),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) { setErrors({ otpCode: json.error ?? "Failed" }); return; }
      set("otpVerified", true);
      setStep(2);
      toast.success("Email verified");
    });
  };

  const uploadDoc = (kind: "gstCert" | "cheque", file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    fd.set("email", form.email);
    startTransition(async () => {
      const r = await fetch("/api/onboarding/upload", { method: "POST", body: fd });
      const json = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !json.url) { toast.error(json.error ?? "Upload failed"); return; }
      if (kind === "gstCert") set("gstCertUrl", json.url);
      else set("chequeUrl", json.url);
      toast.success(`${kind === "gstCert" ? "GST certificate" : "Cancelled cheque"} uploaded`);
    });
  };

  const submit = () => {
    setErrors({});
    if (!form.consent) { setErrors({ consent: "Consent required" }); return; }
    if (form.accountNo !== form.accountNoConfirm) { setErrors({ accountNoConfirm: "Account numbers don't match" }); return; }
    const payload = {
      email: form.email,
      name: form.name,
      businessType: form.businessType,
      yearsInBusiness: form.yearsInBusiness || undefined,
      gst: form.gst || undefined,
      pan: form.pan || undefined,
      address: form.address || undefined,
      contactName: form.contactName,
      designation: form.designation || undefined,
      whatsapp: form.whatsapp || undefined,
      website: form.website || undefined,
      referralSource: form.referralSource || undefined,
      productCategoryHint: form.productCategoryHint || undefined,
      productCountRange: form.productCountRange || undefined,
      priceRange: form.priceRange || undefined,
      catalogLink: form.catalogLink || undefined,
      samplesLink: form.samplesLink || undefined,
      applicationNotes: form.applicationNotes || undefined,
      bankName: form.bankName,
      accountNo: form.accountNo,
      ifsc: form.ifsc,
      accountType: form.accountType,
      branch: form.branch || undefined,
      gstCertUrl: form.gstCertUrl || undefined,
      chequeUrl: form.chequeUrl || undefined,
      consent: "true",
    };
    startTransition(async () => {
      const r = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await r.json()) as { ok?: true; message?: string; error?: string; fieldErrors?: Record<string, string> };
      if (!r.ok) {
        setErrors(json.fieldErrors ?? {});
        toast.error(json.error ?? "Submission failed");
        return;
      }
      setSubmitted({ message: json.message ?? "Submitted." });
    });
  };

  // ── Step validation ──────────────────────────────────────────────────────

  const nextFromStep = () => {
    setErrors({});
    if (step === 2) {
      const errs: Record<string, string> = {};
      if (!form.name.trim()) errs.name = "Business name required";
      if (!form.businessType) errs.businessType = "Pick a business type";
      if (form.gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/.test(form.gst)) errs.gst = "Invalid GST";
      if (form.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan)) errs.pan = "Invalid PAN";
      if (Object.keys(errs).length) { setErrors(errs); return; }
    } else if (step === 3) {
      if (!form.contactName.trim()) { setErrors({ contactName: "Contact name required" }); return; }
    } else if (step === 5) {
      const errs: Record<string, string> = {};
      if (!form.bankName.trim()) errs.bankName = "Bank name required";
      if (!/^[A-Za-z0-9]{6,20}$/.test(form.accountNo)) errs.accountNo = "Account number 6–20 chars";
      if (form.accountNo !== form.accountNoConfirm) errs.accountNoConfirm = "Account numbers don't match";
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) errs.ifsc = "Invalid IFSC";
      if (Object.keys(errs).length) { setErrors(errs); return; }
    }
    setStep((s) => Math.min(6, s + 1) as Step);
  };

  // ── Success screen ───────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="card p-8 text-center animate-in fade-in zoom-in-95 duration-300">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-brand-yellow-light bg-brand-yellow-pale">
          <CheckCircle2 className="h-8 w-8 text-brand-yellow-dark" />
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">Application received</h1>
        <p className="mt-2 text-sm text-ink-faint max-w-md mx-auto">{submitted.message}</p>
        <div className="mt-8 text-xs text-ink-faint">
          We&apos;ll email you at <b className="text-ink">{form.email}</b> once the application is reviewed.
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="card p-8 animate-in fade-in duration-300">
      <Progress step={step} />

      {step === 1 && (
        <Section title="Verify your email" subtitle="We'll send a 6-digit code to confirm it's yours.">
          {!form.otpVerified ? (
            <>
              <Field label="Email" name="email" required>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value.trim())} className="input" autoComplete="email" />
              </Field>
              {errors.email && <ErrLine>{errors.email}</ErrLine>}
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={sendOtp} disabled={pending || !form.email} className="btn-secondary">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send code"}
                </button>
              </div>
              <div className="mt-6">
                <Field label="Verification code" name="otpCode" required>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    pattern="\d{6}"
                    value={form.otpCode}
                    onChange={(e) => set("otpCode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="input font-mono text-lg tracking-[.4em] text-center"
                    placeholder="••••••"
                  />
                </Field>
                {errors.otpCode && <ErrLine>{errors.otpCode}</ErrLine>}
                <div className="mt-2 text-[11px] text-ink-faint">
                  In dev mode, the OTP is logged to the server console (no real email sent unless RESEND_API_KEY is configured).
                </div>
              </div>
            </>
          ) : (
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="inline h-4 w-4 mr-1" /> {form.email} verified.
            </div>
          )}
        </Section>
      )}

      {step === 2 && (
        <Section title="Business information" subtitle="Tell us about your business.">
          <Field label="Business name" name="name" required>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className="input" />
          </Field>
          {errors.name && <ErrLine>{errors.name}</ErrLine>}
          <Grid2>
            <Field label="Business type" name="businessType" required>
              <select value={form.businessType} onChange={(e) => set("businessType", e.target.value)} className="input">
                <option value="">— select —</option>
                {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Years in business" name="yearsInBusiness">
              <select value={form.yearsInBusiness} onChange={(e) => set("yearsInBusiness", e.target.value)} className="input">
                <option value="">— select —</option>
                <option value="<1">Less than 1 year</option>
                <option value="1-3">1–3 years</option>
                <option value="3-5">3–5 years</option>
                <option value="5-10">5–10 years</option>
                <option value="10+">10+ years</option>
              </select>
            </Field>
            <Field label="GST number" name="gst">
              <input value={form.gst} onChange={(e) => set("gst", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} className="input font-mono" placeholder="09AAAAA0000A1Z5" />
            </Field>
            <Field label="PAN" name="pan">
              <input value={form.pan} onChange={(e) => set("pan", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} className="input font-mono" placeholder="AAAAA0000A" />
            </Field>
          </Grid2>
          {errors.businessType && <ErrLine>{errors.businessType}</ErrLine>}
          {errors.gst && <ErrLine>{errors.gst}</ErrLine>}
          {errors.pan && <ErrLine>{errors.pan}</ErrLine>}
          <Field label="Address" name="address">
            <textarea value={form.address} onChange={(e) => set("address", e.target.value)} className="input min-h-[80px]" />
          </Field>
        </Section>
      )}

      {step === 3 && (
        <Section title="Contact" subtitle="Who can we reach out to?">
          <Grid2>
            <Field label="Contact person" name="contactName" required>
              <input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} className="input" />
            </Field>
            <Field label="Designation" name="designation">
              <input value={form.designation} onChange={(e) => set("designation", e.target.value)} className="input" />
            </Field>
            <Field label="WhatsApp" name="whatsapp">
              <input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, "").slice(0, 15))} className="input" />
            </Field>
            <Field label="Website / Instagram" name="website">
              <input value={form.website} onChange={(e) => set("website", e.target.value)} className="input" />
            </Field>
          </Grid2>
          {errors.contactName && <ErrLine>{errors.contactName}</ErrLine>}
          <Field label="How did you hear about us?" name="referralSource">
            <select value={form.referralSource} onChange={(e) => set("referralSource", e.target.value)} className="input">
              <option value="">— select —</option>
              <option>Search engine</option>
              <option>Social media</option>
              <option>Existing vendor referral</option>
              <option>Trade show / event</option>
              <option>Industry contact</option>
              <option>Other</option>
            </select>
          </Field>
        </Section>
      )}

      {step === 4 && (
        <Section title="Product catalog" subtitle="What you sell, broadly.">
          <Field label="Product category / what you sell" name="productCategoryHint">
            <input value={form.productCategoryHint} onChange={(e) => set("productCategoryHint", e.target.value)} className="input" placeholder="e.g. women's ethnic wear, home decor, fashion jewelry" />
          </Field>
          <Grid2>
            <Field label="Active SKU count" name="productCountRange">
              <select value={form.productCountRange} onChange={(e) => set("productCountRange", e.target.value)} className="input">
                <option value="">— select —</option>
                <option>&lt; 50</option>
                <option>50–200</option>
                <option>200–500</option>
                <option>500–2,000</option>
                <option>2,000+</option>
              </select>
            </Field>
            <Field label="Price range per piece" name="priceRange">
              <select value={form.priceRange} onChange={(e) => set("priceRange", e.target.value)} className="input">
                <option value="">— select —</option>
                <option>&lt; ₹500</option>
                <option>₹500–2,000</option>
                <option>₹2,000–5,000</option>
                <option>₹5,000–10,000</option>
                <option>₹10,000+</option>
              </select>
            </Field>
            <Field label="Catalog link" name="catalogLink">
              <input value={form.catalogLink} onChange={(e) => set("catalogLink", e.target.value)} className="input" placeholder="Drive / Dropbox / OneDrive" />
            </Field>
            <Field label="Sample images link" name="samplesLink">
              <input value={form.samplesLink} onChange={(e) => set("samplesLink", e.target.value)} className="input" />
            </Field>
          </Grid2>
          <Field label="Additional notes" name="applicationNotes">
            <textarea value={form.applicationNotes} onChange={(e) => set("applicationNotes", e.target.value)} className="input min-h-[80px]" />
          </Field>
        </Section>
      )}

      {step === 5 && (
        <Section title="Bank & documents" subtitle="Where do we pay you, and proof of ownership.">
          <Grid2>
            <Field label="Bank name" name="bankName" required>
              <input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className="input" />
            </Field>
            <Field label="IFSC" name="ifsc" required>
              <input value={form.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))} className="input font-mono" />
            </Field>
            <Field label="Account number" name="accountNo" required>
              <input value={form.accountNo} onChange={(e) => set("accountNo", e.target.value.replace(/\s/g, ""))} className="input font-mono" />
            </Field>
            <Field label="Confirm account number" name="accountNoConfirm" required>
              <input value={form.accountNoConfirm} onChange={(e) => set("accountNoConfirm", e.target.value.replace(/\s/g, ""))} className="input font-mono" />
            </Field>
            <Field label="Account type" name="accountType" required>
              <select value={form.accountType} onChange={(e) => set("accountType", e.target.value)} className="input">
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Branch" name="branch">
              <input value={form.branch} onChange={(e) => set("branch", e.target.value)} className="input" />
            </Field>
          </Grid2>
          {errors.bankName && <ErrLine>{errors.bankName}</ErrLine>}
          {errors.ifsc && <ErrLine>{errors.ifsc}</ErrLine>}
          {errors.accountNo && <ErrLine>{errors.accountNo}</ErrLine>}
          {errors.accountNoConfirm && <ErrLine>{errors.accountNoConfirm}</ErrLine>}

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <UploadCard label="GST certificate" file={form.gstCertUrl} onPick={(f) => uploadDoc("gstCert", f)} />
            <UploadCard label="Cancelled cheque" file={form.chequeUrl} onPick={(f) => uploadDoc("cheque", f)} />
          </div>
        </Section>
      )}

      {step === 6 && (
        <Section title="Review & submit" subtitle="Confirm and submit your application.">
          <ReviewBlock title="Business" rows={[
            ["Name", form.name],
            ["Type", BUSINESS_TYPE_LABELS[form.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? form.businessType],
            ["Years", form.yearsInBusiness],
            ["GST", form.gst],
            ["PAN", form.pan],
            ["Address", form.address],
          ]} />
          <ReviewBlock title="Contact" rows={[
            ["Email", form.email],
            ["Person", `${form.contactName}${form.designation ? ` (${form.designation})` : ""}`],
            ["WhatsApp", form.whatsapp],
            ["Web", form.website],
          ]} />
          <ReviewBlock title="Catalog" rows={[
            ["Category", form.productCategoryHint],
            ["SKU count", form.productCountRange],
            ["Price range", form.priceRange],
            ["Catalog link", form.catalogLink],
            ["Samples link", form.samplesLink],
          ]} />
          <ReviewBlock title="Bank" rows={[
            ["Bank", form.bankName],
            ["IFSC", form.ifsc],
            ["Account", form.accountNo ? `••••${form.accountNo.slice(-4)}` : ""],
            ["Type", form.accountType],
            ["Branch", form.branch],
          ]} />
          <ReviewBlock title="Documents" rows={[
            ["GST certificate", form.gstCertUrl ? "uploaded" : "not uploaded"],
            ["Cancelled cheque", form.chequeUrl ? "uploaded" : "not uploaded"],
          ]} />

          <label className="mt-6 flex gap-3 items-start rounded border border-brand-yellow-light bg-brand-yellow-50 px-4 py-3">
            <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-0.5 accent-brand-yellow-dark" />
            <span className="text-sm">
              I confirm the above information is accurate and consent to Adwitiya Global verifying these details for vendor onboarding.
            </span>
          </label>
          {errors.consent && <ErrLine>{errors.consent}</ErrLine>}
        </Section>
      )}

      <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
        {step > 1 ? (
          <button type="button" onClick={() => setStep((s) => Math.max(1, s - 1) as Step)} className="btn-secondary">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        ) : <span />}

        {step === 1 && !form.otpVerified && (
          <button type="button" onClick={verifyOtp} disabled={pending || form.otpCode.length !== 6} className="btn-primary">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & continue"} <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {step >= 2 && step < 6 && (
          <button type="button" onClick={nextFromStep} className="btn-primary">
            Next <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {step === 6 && (
          <button type="button" onClick={submit} disabled={pending} className="btn-yellow">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit application"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function Progress({ step }: { step: Step }) {
  return (
    <div className="mb-6 flex items-center gap-1">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <div key={n} className="flex-1">
          <div
            className={`h-1.5 rounded-full transition-all ${n <= step ? "bg-brand-yellow" : "bg-border"}`}
            aria-label={`Step ${n} of 6`}
          />
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[.12em] text-brand-yellow-dark">Step</div>
        <h2 className="font-display text-2xl font-bold mt-0.5">{title}</h2>
        {subtitle && <p className="text-sm text-ink-faint">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, name, required, children }: { label: string; name: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}{required && <span className="text-red-600"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function ErrLine({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-red-700">{children}</div>;
}

function UploadCard({ label, file, onPick }: { label: string; file: string; onPick: (f: File) => void }) {
  return (
    <label className="card flex flex-col items-center justify-center gap-2 p-6 cursor-pointer border-dashed hover:border-brand-yellow-dark transition">
      <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.target.value = "";
      }} />
      {file ? (
        <>
          <FileText className="h-6 w-6 text-brand-yellow-dark" />
          <div className="text-sm font-bold">{label}</div>
          <div className="text-[11px] text-green-700"><CheckCircle2 className="inline h-3 w-3 mr-1" /> uploaded · click to replace</div>
        </>
      ) : (
        <>
          <Upload className="h-6 w-6 text-ink-faint" />
          <div className="text-sm font-bold">{label}</div>
          <div className="text-[11px] text-ink-faint">PDF / JPG / PNG · max 5 MB</div>
        </>
      )}
    </label>
  );
}

function ReviewBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  const filled = rows.filter((r) => r[1] && r[1] !== "");
  if (filled.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">{title}</div>
      <dl className="divide-y divide-border">
        {filled.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-4 py-2">
            <dt className="w-32 shrink-0 text-xs text-ink-faint">{k}</dt>
            <dd className="text-sm break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
