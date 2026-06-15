import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { getActiveCompanyGstins, getActiveCompanyId } from "@/lib/company";
import { WarehousePanel } from "./WarehousePanel";

export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  await requireAdmin();
  const companyId = await getActiveCompanyId();
  const [warehouses, vendors, companyGstins] = await Promise.all([
    prisma.warehouse.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: {
        vendor: { select: { id: true, code: true, name: true } },
        place: {
          select: {
            id: true,
            nickname: true,
            placeType: true,
            address: true,
            city: true,
            pincode: true,
            gstin: { select: { gstin: true, state: true } },
          },
        },
      },
    }),
    prisma.vendor.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: "asc" }],
    }),
    // Multi-GSTIN registry + places. Drives both the "GSTIN: …" hint and
    // the per-state Place picker. Already cookie-aware via getActiveCompanyGstins.
    getActiveCompanyGstins(),
  ]);

  // Flatten GSTINs → Places (with their parent GSTIN info) so the panel
  // can offer Place-level suggestions filtered by warehouse state.
  const places = companyGstins.flatMap((g) =>
    g.isActive
      ? g.places
          .filter((p) => p.isActive)
          .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            placeType: p.placeType,
            address: p.address,
            city: p.city,
            pincode: p.pincode,
            gstin: g.gstin,
            state: g.state,
            // Mark places already bound to a different warehouse so the
            // picker can grey them out.
            takenByWarehouseId: p.warehouse?.id ?? null,
          }))
      : [],
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Warehouse Master</h1>
        <p className="text-sm text-ink-faint">
          Define warehouses. Mark third-party ones with the vendor they belong to. Own warehouses
          can link to a declared Place under your GSTIN — that&apos;s what makes invoices compliant.
        </p>
      </div>
      <WarehousePanel
        vendors={vendors}
        places={places}
        rows={warehouses.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          address: w.address,
          city: w.city,
          state: w.state,
          pincode: w.pincode,
          country: w.country,
          gst: w.gst,
          type: w.type,
          vendorId: w.vendorId,
          vendorLabel: w.vendor ? (w.vendor.code ? `${w.vendor.code} · ${w.vendor.name}` : w.vendor.name) : null,
          placeId: w.placeId,
          place: w.place
            ? {
                id: w.place.id,
                nickname: w.place.nickname,
                placeType: w.place.placeType,
                gstin: w.place.gstin.gstin,
                state: w.place.gstin.state,
                address: w.place.address,
                city: w.place.city,
                pincode: w.place.pincode,
              }
            : null,
        }))}
      />
    </div>
  );
}
