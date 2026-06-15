import { prisma } from "@/lib/db";
import { requireVendor } from "@/lib/rbac";
import { buildVendorLedger } from "@/lib/vendor-ledger";
import { VendorLedgerView } from "./VendorLedgerView";

export default async function VendorLedgerPage() {
  const me = await requireVendor();

  const [ledger, vendor] = await Promise.all([
    buildVendorLedger(me.vendorId),
    prisma.vendor.findUnique({ where: { id: me.vendorId }, select: { code: true, name: true } }),
  ]);

  // Bucket every row into FTV / OR / Other so the view can switch the ledger
  // model-wise. Running balance + totals are recomputed per active bucket in the
  // client, so we just hand over the raw debit/credit + the model tag here.
  const rows = ledger.entries.map((e) => ({
    date: e.date,
    type: e.type,
    docNo: e.docNo,
    label: e.label,
    debit: e.debit,
    credit: e.credit,
    model: e.model,
    bucket: bucketOf(e.model),
  }));

  return (
    <div>
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">{vendor?.code}</div>
        <h1 className="font-display text-3xl font-bold">{vendor?.name} — Ledger</h1>
        <p className="text-sm text-ink-faint">
          Purchase (OR, due GRN + term) + FTV sales accrual + Return-to-Vendor + Payment + Other Charges, with running balance.
        </p>
      </div>
      <VendorLedgerView vendorCode={vendor?.code ?? ""} rows={rows} />
    </div>
  );
}

/** Group a model code into the three buckets the vendor switches between.
 *  FTV* = pay-on-sale models · OR = pay-on-GRN · Other = untagged / anything else. */
function bucketOf(model: string | null): "FTV" | "OR" | "Other" {
  if (!model) return "Other";
  const m = model.toUpperCase();
  if (m === "OR") return "OR";
  if (m.startsWith("FTV")) return "FTV";
  return "Other";
}
