import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveCompanyId } from "@/lib/company";
import { CompanyProfileEditor } from "./CompanyProfileEditor";
import { GstinManager } from "./GstinManager";

export const dynamic = "force-dynamic";

export default async function CompanyProfilePage() {
  await requireAdmin();

  // Show the ACTIVE company (set via topbar dropdown), not just the
  // primary — so switching companies actually changes what you see.
  const activeId = await getActiveCompanyId();
  const company = await prisma.company.findUnique({ where: { id: activeId } });
  if (!company) {
    return (
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-bold">Company Profile</h1>
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Active company not found in DB — clear the active-company cookie or run{" "}
          <code className="font-mono">pnpm db:seed</code>.
        </div>
      </div>
    );
  }

  const gstins = await prisma.companyGSTIN.findMany({
    where: { companyId: company.id },
    orderBy: [{ isDefault: "desc" }, { state: "asc" }],
    include: {
      places: {
        orderBy: [{ placeType: "asc" }, { nickname: "asc" }],
        include: {
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              address: true,
              city: true,
              pincode: true,
            },
          },
        },
      },
    },
  });

  // Linkable warehouses for the Place form's "Link to warehouse" picker —
  // OWN warehouses not yet bound to a place. The server action does the
  // state-match check; we pre-filter here for UI convenience.
  const linkableWarehouses = await prisma.warehouse.findMany({
    where: { type: "OWN", place: null },
    select: { id: true, code: true, name: true, state: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Company Profile</h1>
        <p className="text-sm text-ink-faint">
          Replaces the hardcoded ORG. Edits show up on invoices, PO PDFs, and headers across the app.
        </p>
      </div>

      <section className="card p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Company details</div>
        <CompanyProfileEditor
          initial={{
            legalName: company.legalName,
            brandName: company.brandName,
            pan: company.pan,
            tan: company.tan,
            cin: company.cin,
            address: company.address,
            city: company.city,
            state: company.state,
            pincode: company.pincode,
            country: company.country,
            email: company.email,
            mobile: company.mobile,
            website: company.website,
            logoUrl: company.logoUrl,
            baseCurrency: company.baseCurrency,
            fyStartMonth: company.fyStartMonth,
            bankName: company.bankName,
            accountNo: company.accountNo,
            ifsc: company.ifsc,
          }}
        />
      </section>

      <section className="card p-6">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">GSTIN registry</div>
        <p className="mb-4 text-xs text-ink-faint">
          One GSTIN per state where you&apos;re registered. Under each GSTIN, declare your Principal
          Place of Business (PPOB) and any Additional Places (APOBs) — branches, warehouses, offices.
        </p>
        <GstinManager
          gstins={gstins.map((g) => ({
            id: g.id,
            gstin: g.gstin,
            state: g.state,
            registrationType: g.registrationType,
            isActive: g.isActive,
            isDefault: g.isDefault,
            places: g.places.map((p) => ({
              id: p.id,
              nickname: p.nickname,
              placeType: p.placeType,
              address: p.address,
              city: p.city,
              pincode: p.pincode,
              isActive: p.isActive,
              warehouse: p.warehouse
                ? {
                    id: p.warehouse.id,
                    code: p.warehouse.code,
                    name: p.warehouse.name,
                    address: p.warehouse.address,
                    city: p.warehouse.city,
                    pincode: p.warehouse.pincode,
                  }
                : null,
            })),
          }))}
          linkableWarehouses={linkableWarehouses}
        />
      </section>
    </div>
  );
}
