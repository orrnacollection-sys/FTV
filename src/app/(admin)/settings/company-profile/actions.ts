"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { getActiveCompanyId } from "@/lib/company";
import {
  companySchema,
  companyGstinSchema,
  companyPlaceSchema,
} from "@/lib/validators/company";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(e: import("zod").ZodError) {
  return Object.fromEntries(
    Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
  );
}

function rawToObj(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) o[k] = String(v);
  return o;
}

/** Re-fetch the cached company header — call after every write. */
function invalidate() {
  revalidateTag("active-company");
  revalidatePath("/settings/company-profile");
  // Warehouse list reads the same data via getActiveCompanyGstins().
  revalidatePath("/warehouses");
}

/** Update the primary company row. Edits only — Adwitiya was seeded. */
export async function updateCompany(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = companySchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  }

  // Update the ACTIVE company, not just the primary, so admin can edit
  // each company's profile by switching to it in the topbar.
  const activeId = await getActiveCompanyId();
  const before = await prisma.company.findUnique({ where: { id: activeId } });
  if (!before) return { error: "Active company not found." };

  await prisma.company.update({
    where: { id: before.id },
    data: {
      legalName: parsed.data.legalName,
      brandName: parsed.data.brandName,
      pan: parsed.data.pan ?? null,
      tan: parsed.data.tan ?? null,
      cin: parsed.data.cin ?? null,
      address: parsed.data.address ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      pincode: parsed.data.pincode ?? null,
      country: parsed.data.country ?? null,
      email: parsed.data.email ?? null,
      mobile: parsed.data.mobile ?? null,
      website: parsed.data.website ?? null,
      logoUrl: parsed.data.logoUrl ?? null,
      baseCurrency: parsed.data.baseCurrency,
      fyStartMonth: parsed.data.fyStartMonth,
      bankName: parsed.data.bankName ?? null,
      accountNo: parsed.data.accountNo ?? null,
      ifsc: parsed.data.ifsc ?? null,
    },
  });
  await logWrite("Company", before.id, "UPDATE", before, parsed.data);
  invalidate();
  return { ok: true };
}

// ── GSTIN registrations ──────────────────────────────────────────────────────

export async function createGstin(fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = companyGstinSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  }

  // GSTINs are added to the ACTIVE company — switching companies in the
  // topbar changes which company's GSTIN registry you're editing.
  const activeId = await getActiveCompanyId();
  const company = { id: activeId };

  try {
    await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.companyGSTIN.updateMany({
          where: { companyId: company.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      await tx.companyGSTIN.create({
        data: {
          companyId: company.id,
          gstin: parsed.data.gstin,
          state: parsed.data.state,
          registrationType: parsed.data.registrationType,
          isActive: parsed.data.isActive,
          isDefault: parsed.data.isDefault,
        },
      });
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "That GSTIN is already registered" };
    }
    return { error: "Failed to add GSTIN" };
  }
  await logWrite("CompanyGSTIN", "n/a", "CREATE", null, parsed.data);
  invalidate();
  return { ok: true };
}

export async function updateGstin(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = companyGstinSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  }

  const before = await prisma.companyGSTIN.findUnique({ where: { id } });
  if (!before) return { error: "GSTIN not found" };

  try {
    await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault && !before.isDefault) {
        await tx.companyGSTIN.updateMany({
          where: { companyId: before.companyId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      await tx.companyGSTIN.update({
        where: { id },
        data: {
          gstin: parsed.data.gstin,
          state: parsed.data.state,
          registrationType: parsed.data.registrationType,
          isActive: parsed.data.isActive,
          isDefault: parsed.data.isDefault,
        },
      });
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { error: "That GSTIN is already registered" };
    }
    return { error: "Failed to update GSTIN" };
  }
  await logWrite("CompanyGSTIN", id, "UPDATE", before, parsed.data);
  invalidate();
  return { ok: true };
}

export async function deleteGstin(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.companyGSTIN.findUnique({
    where: { id },
    include: { places: { select: { id: true } } },
  });
  if (!before) return { error: "GSTIN not found" };
  if (before.isDefault) {
    return { error: "Pick another GSTIN as default before deleting this one" };
  }
  if (before.places.length > 0) {
    return { error: "Delete the places under this GSTIN first" };
  }
  await prisma.companyGSTIN.delete({ where: { id } });
  await logWrite("CompanyGSTIN", id, "DELETE", before, null);
  invalidate();
  return { ok: true };
}

// ── Places under a GSTIN ─────────────────────────────────────────────────────

async function ensureWarehouseLinkable(
  warehouseId: string,
  gstinState: string,
): Promise<{ ok: true } | { error: string }> {
  const w = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { type: true, state: true, code: true, place: { select: { id: true } } },
  });
  if (!w) return { error: "Selected warehouse not found" };
  if (w.type === "THIRD_PARTY") {
    return { error: `${w.code}: third-party warehouses can't link to your GST — vendor handles compliance.` };
  }
  if (w.state && w.state !== gstinState) {
    return { error: `${w.code} is in ${w.state}, but this GSTIN is registered in ${gstinState}.` };
  }
  if (w.place && w.place.id) {
    return { error: `${w.code} is already linked to another Place. Unlink it first.` };
  }
  return { ok: true };
}

export async function createPlace(gstinId: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = companyPlaceSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  }
  const gstin = await prisma.companyGSTIN.findUnique({
    where: { id: gstinId },
    select: { id: true, state: true },
  });
  if (!gstin) return { error: "Parent GSTIN not found" };

  if (parsed.data.warehouseId) {
    const check = await ensureWarehouseLinkable(parsed.data.warehouseId, gstin.state);
    if ("error" in check) return check;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Demote any existing PPOB under this GSTIN if the new place claims PPOB.
      if (parsed.data.placeType === "PPOB") {
        await tx.companyGSTINPlace.updateMany({
          where: { gstinId, placeType: "PPOB" },
          data: { placeType: "APOB" },
        });
      }
      const newPlace = await tx.companyGSTINPlace.create({
        data: {
          gstinId,
          nickname: parsed.data.nickname,
          placeType: parsed.data.placeType,
          address: parsed.data.address ?? null,
          city: parsed.data.city ?? null,
          pincode: parsed.data.pincode ?? null,
          isActive: parsed.data.isActive,
        },
      });
      // Link the warehouse last so all invariants are stable.
      if (parsed.data.warehouseId) {
        await tx.warehouse.update({
          where: { id: parsed.data.warehouseId },
          data: { placeId: newPlace.id },
        });
      }
    });
  } catch {
    return { error: "Failed to add place" };
  }
  await logWrite("CompanyGSTINPlace", "n/a", "CREATE", null, { gstinId, ...parsed.data });
  invalidate();
  return { ok: true };
}

export async function updatePlace(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const parsed = companyPlaceSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  }
  const before = await prisma.companyGSTINPlace.findUnique({
    where: { id },
    include: { gstin: { select: { state: true } }, warehouse: { select: { id: true } } },
  });
  if (!before) return { error: "Place not found" };

  // Warehouse link change — validate the new pick.
  const previousWarehouseId = before.warehouse?.id ?? null;
  const newWarehouseId = parsed.data.warehouseId ?? null;
  if (newWarehouseId && newWarehouseId !== previousWarehouseId) {
    const check = await ensureWarehouseLinkable(newWarehouseId, before.gstin.state);
    if ("error" in check) return check;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (parsed.data.placeType === "PPOB" && before.placeType !== "PPOB") {
        await tx.companyGSTINPlace.updateMany({
          where: { gstinId: before.gstinId, placeType: "PPOB", id: { not: id } },
          data: { placeType: "APOB" },
        });
      }
      await tx.companyGSTINPlace.update({
        where: { id },
        data: {
          nickname: parsed.data.nickname,
          placeType: parsed.data.placeType,
          address: parsed.data.address ?? null,
          city: parsed.data.city ?? null,
          pincode: parsed.data.pincode ?? null,
          isActive: parsed.data.isActive,
        },
      });
      // Re-wire warehouse link if it changed.
      if (newWarehouseId !== previousWarehouseId) {
        if (previousWarehouseId) {
          await tx.warehouse.update({
            where: { id: previousWarehouseId },
            data: { placeId: null },
          });
        }
        if (newWarehouseId) {
          await tx.warehouse.update({
            where: { id: newWarehouseId },
            data: { placeId: id },
          });
        }
      }
    });
  } catch {
    return { error: "Failed to update place" };
  }
  await logWrite("CompanyGSTINPlace", id, "UPDATE", before, parsed.data);
  invalidate();
  return { ok: true };
}

export async function deletePlace(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.companyGSTINPlace.findUnique({
    where: { id },
    include: { warehouse: { select: { id: true } } },
  });
  if (!before) return { error: "Place not found" };
  if (before.placeType === "PPOB") {
    return { error: "Can't delete the PPOB — promote another place to PPOB first." };
  }
  // Warehouse link is broken by onDelete: SetNull, so no extra work needed.
  await prisma.companyGSTINPlace.delete({ where: { id } });
  await logWrite("CompanyGSTINPlace", id, "DELETE", before, null);
  invalidate();
  return { ok: true };
}
