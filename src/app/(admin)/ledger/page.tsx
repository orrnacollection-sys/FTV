import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { buildVendorLedger, type LedgerEntry } from "@/lib/vendor-ledger";
import { companyWhere } from "@/lib/scope";
import { LedgerView } from "./LedgerView";
import { LedgerSummaryView, type SummaryRow } from "./LedgerSummaryView";

export const dynamic = "force-dynamic";

type ModelOpt = { code: string; label: string; basis: string };

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string; model?: string; view?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scope = await companyWhere();

  const [vendors, activeModels] = await Promise.all([
    prisma.vendor.findMany({
      where: { ...scope, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.modelMaster.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, label: true, paymentBasis: true },
    }),
  ]);
  const allModels: ModelOpt[] = activeModels.map((m) => ({ code: m.code, label: m.label, basis: m.paymentBasis }));

  // Cross-vendor quick-view: build a row per vendor for the requested basis
  // (ON_GRN = OR, ON_SALE = FTV) so you can eyeball every account in one shot.
  if (sp.view === "or-summary" || sp.view === "ftv-summary") {
    const targetBasis = sp.view === "or-summary" ? "ON_GRN" : "ON_SALE";
    const rows: SummaryRow[] = [];
    for (const v of vendors) {
      const ledger = await buildVendorLedger(v.id);
      let credit = 0, debit = 0, balance = 0;
      const models: string[] = [];
      for (const [model, m] of Object.entries(ledger.byModel)) {
        if (m.basis !== targetBasis) continue;
        credit += m.credit; debit += m.debit; balance += m.balance;
        if (model !== "—") models.push(model);
      }
      if (credit !== 0 || debit !== 0) {
        rows.push({
          vendorId: v.id,
          vendorCode: v.code,
          vendorName: v.name,
          models,
          credit, debit, balance,
          overdue: targetBasis === "ON_GRN" ? ledger.tiles.orOverdue : 0,
        });
      }
    }
    rows.sort((a, b) => b.balance - a.balance);
    return (
      <div>
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Vendor Ledger</h1>
          <p className="text-sm text-ink-faint">
            {sp.view === "or-summary" ? "OR" : "FTV"} snapshot across every active vendor · drill in by clicking a row
          </p>
        </div>
        <LedgerSummaryView basis={targetBasis} rows={rows} />
      </div>
    );
  }

  let selectedVendor: { code: string | null; name: string } | null = null;
  let rows: (LedgerEntry & { balance: number })[] = [];
  let summary = { totalDebit: 0, totalCredit: 0, balance: 0 };
  let modelsPresent: { code: string; basis: string }[] = [];
  let tiles = { ftvPayable: 0, orPayable: 0, orOverdue: 0, monthFtvSales: 0 };

  if (sp.vendorId) {
    const v = vendors.find((x) => x.id === sp.vendorId);
    if (v) selectedVendor = { code: v.code, name: v.name };

    const ledger = await buildVendorLedger(sp.vendorId);
    modelsPresent = ledger.modelsPresent;
    tiles = ledger.tiles;

    // Filter by the active model tab, then compute a running balance for that view.
    const filtered = sp.model
      ? ledger.entries.filter((e) => e.model === sp.model)
      : ledger.entries;
    let bal = 0;
    rows = filtered.map((e) => {
      bal += e.credit - e.debit;
      return { ...e, balance: bal };
    });
    summary = {
      totalDebit: filtered.reduce((s, e) => s + e.debit, 0),
      totalCredit: filtered.reduce((s, e) => s + e.credit, 0),
      balance: bal,
    };
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Vendor Ledger</h1>
        <p className="text-sm text-ink-faint">
          Model-aware: OR is credited at GRN (due GRN + term); FTV accrues on sale. Filter by model or view combined.
        </p>
      </div>
      <LedgerView
        vendors={vendors}
        selectedVendor={selectedVendor}
        rows={rows}
        summary={summary}
        modelsPresent={modelsPresent}
        allModels={allModels}
        tiles={tiles}
        initialVendorId={sp.vendorId ?? ""}
        initialModel={sp.model ?? ""}
      />
    </div>
  );
}
