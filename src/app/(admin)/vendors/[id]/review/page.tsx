import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { toDisplayDate } from "@/lib/date";
import { ChevronLeft, FileText, ExternalLink } from "lucide-react";
import { BUSINESS_TYPE_LABELS, ACCOUNT_TYPE_LABELS } from "@/lib/validators/application";
import { getActiveCompanyId } from "@/lib/company";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";

export default async function ApplicationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const v = await prisma.vendor.findFirst({ where: { id, companyId } });
  if (!v) notFound();

  const reviewer = v.reviewedById ? await prisma.user.findUnique({ where: { id: v.reviewedById }, select: { username: true } }) : null;

  const Section = ({ title, rows }: { title: string; rows: Array<[string, React.ReactNode]> }) => {
    const filled = rows.filter(([, val]) => val !== null && val !== undefined && val !== "");
    if (filled.length === 0) return null;
    return (
      <div className="card overflow-hidden">
        <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">{title}</div>
        <dl className="divide-y divide-border">
          {filled.map(([k, val]) => (
            <div key={k} className="flex gap-3 px-4 py-2">
              <dt className="w-40 shrink-0 text-xs text-ink-faint">{k}</dt>
              <dd className="text-sm break-words">{val}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  };

  const docLink = (url: string | null, label: string) =>
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-yellow-dark hover:underline">
        <FileText className="h-3.5 w-3.5" /> {label} <ExternalLink className="h-3 w-3" />
      </a>
    ) : (
      <span className="text-ink-faint">not uploaded</span>
    );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/vendors?status=PENDING" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Back to applications
        </Link>
        <h1 className="font-display text-3xl font-bold mt-1">{v.name}</h1>
        <p className="text-sm text-ink-faint">
          {v.code} ·{" "}
          <span className={`badge ${
            v.status === "PENDING" ? "border-amber-300 bg-amber-50 text-amber-800"
            : v.status === "ACTIVE" ? "border-green-300 bg-green-50 text-green-800"
            : "border-gray-300 bg-gray-50 text-gray-700"
          }`}>{v.status}</span>
          {v.appliedAt && <> · Applied {toDisplayDate(v.appliedAt)}</>}
        </p>
        {v.status !== "PENDING" && v.reviewedAt && (
          <div className="mt-2 rounded border border-border bg-surface-gray-100 px-3 py-2 text-xs">
            <b>{v.status === "ACTIVE" ? "Approved" : "Rejected"}</b> by {reviewer?.username ?? "unknown"} on {toDisplayDate(v.reviewedAt)}
            {v.reviewNotes && <div className="mt-1 text-ink-mid">{v.reviewNotes}</div>}
          </div>
        )}
      </div>

      <Section title="Business" rows={[
        ["Name", v.name],
        ["Type", v.businessType ? BUSINESS_TYPE_LABELS[v.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? v.businessType : ""],
        ["Years", v.yearsInBusiness],
        ["GST", v.gst],
        ["PAN", v.pan],
        ["Address", v.address],
        ["City", v.city],
        ["State", v.state],
        ["Pincode", v.pincode],
        ["Country", v.country],
        ["Vendor Code", v.code ?? ""],
      ]} />

      <Section title="Contact" rows={[
        ["Email", v.email],
        ["Contact person", v.contactName],
        ["Designation", v.designation],
        ["WhatsApp", v.whatsapp],
        ["Website", v.website],
        ["Heard about us via", v.referralSource],
      ]} />

      <Section title="Catalog" rows={[
        ["Category hint", v.productCategoryHint],
        ["SKU count range", v.productCountRange],
        ["Price range", v.priceRange],
        ["Catalog link", v.catalogLink],
        ["Samples link", v.samplesLink],
        ["Notes", v.applicationNotes],
      ]} />

      <Section title="Bank" rows={[
        ["Bank", v.bankName],
        ["IFSC", v.ifsc],
        ["Account number", v.accountNo ? `••••${v.accountNo.slice(-4)}` : null],
        ["Type", v.accountType ? ACCOUNT_TYPE_LABELS[v.accountType as keyof typeof ACCOUNT_TYPE_LABELS] ?? v.accountType : ""],
        ["Branch", v.branch],
      ]} />

      <Section title="Documents" rows={[
        ["GST certificate", docLink(v.gstCertUrl, "View")],
        ["Cancelled cheque", docLink(v.chequeUrl, "View")],
      ]} />

      {v.status === "PENDING" && (
        <ReviewActions vendorId={v.id} vendorName={v.name} vendorCode={v.code} hasEmail={!!v.email} />
      )}
    </div>
  );
}
