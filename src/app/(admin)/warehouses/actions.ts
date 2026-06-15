"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { warehouseSchema } from "@/lib/validators/warehouse";
import { nextDocNumber } from "@/lib/series";
import { logWrite } from "@/lib/audit";
import { getActiveCompanyId } from "@/lib/company";

type Result = { ok: true } | { ok?: undefined; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(e: import("zod").ZodError) {
  return Object.fromEntries(
    Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
  );
}

/** Claim the next WH-### code (series auto-creates per-company since #134). */
async function nextWarehouseCode(tx: import("@prisma/client").Prisma.TransactionClient): Promise<string> {
  return nextDocNumber("WAREHOUSE", tx);
}

/** Pull the 10 form fields off FormData → object Zod can consume. */
function readForm(fd: FormData) {
  return {
    name: String(fd.get("name") ?? ""),
    address: String(fd.get("address") ?? ""),
    city: String(fd.get("city") ?? ""),
    state: String(fd.get("state") ?? ""),
    pincode: String(fd.get("pincode") ?? ""),
    country: String(fd.get("country") ?? ""),
    gst: String(fd.get("gst") ?? ""),
    type: String(fd.get("type") ?? "OWN"),
    vendorId: String(fd.get("vendorId") ?? ""),
    placeId: String(fd.get("placeId") ?? ""),
  };
}

/** Validate the placeId picked on the form. Returns the placeId to persist
 *  (null when unset or invalid for this warehouse). */
async function resolvePlaceId(
  raw: string | undefined,
  type: string,
  state: string | undefined,
): Promise<string | null | { error: string }> {
  if (!raw) return null;
  // Third-party warehouses cannot link to our GSTIN Places — that's the
  // vendor's compliance, not ours.
  if (type === "THIRD_PARTY") return { error: "Third-party warehouses can't link to your GST places." };
  const place = await prisma.companyGSTINPlace.findUnique({
    where: { id: raw },
    include: { gstin: { select: { state: true } } },
  });
  if (!place) return { error: "Selected Place no longer exists." };
  if (state && place.gstin.state !== state) {
    return { error: `Place is registered in ${place.gstin.state}, but this warehouse is in ${state}.` };
  }
  return raw;
}

export async function createWarehouse(fd: FormData): Promise<Result> {
  await requireAdmin();
  const raw = readForm(fd);
  const parsed = warehouseSchema.safeParse(raw);
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  const data = parsed.data;

  const placeIdOrErr = await resolvePlaceId(raw.placeId || undefined, data.type, data.state);
  if (placeIdOrErr && typeof placeIdOrErr === "object") return placeIdOrErr;

  let id = "";
  let code = "";
  try {
    const companyId = await getActiveCompanyId();
    const wh = await prisma.$transaction(async (tx) => {
      code = await nextWarehouseCode(tx);
      return tx.warehouse.create({
        data: {
          code,
          name: data.name,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          pincode: data.pincode ?? null,
          country: data.country ?? null,
          gst: data.gst ?? null,
          type: data.type,
          vendorId: data.type === "THIRD_PARTY" ? data.vendorId ?? null : null,
          placeId: placeIdOrErr as string | null,
          companyId,
        },
      });
    });
    id = wh.id;
  } catch {
    return { error: "Failed to create warehouse" };
  }
  await logWrite("Warehouse", id, "CREATE", null, { code, ...data, placeId: placeIdOrErr });
  revalidatePath("/warehouses");
  revalidatePath("/settings/company-profile");
  return { ok: true };
}

export async function updateWarehouse(id: string, fd: FormData): Promise<Result> {
  await requireAdmin();
  const raw = readForm(fd);
  const parsed = warehouseSchema.safeParse(raw);
  if (!parsed.success) return { error: "Validation failed", fieldErrors: fieldErrors(parsed.error) };
  const data = parsed.data;

  const before = await prisma.warehouse.findUnique({ where: { id } });
  if (!before) return { error: "Warehouse not found" };

  const placeIdOrErr = await resolvePlaceId(raw.placeId || undefined, data.type, data.state);
  if (placeIdOrErr && typeof placeIdOrErr === "object") return placeIdOrErr;

  await prisma.warehouse.update({
    where: { id },
    data: {
      name: data.name,
      address: data.address ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      country: data.country ?? null,
      gst: data.gst ?? null,
      type: data.type,
      vendorId: data.type === "THIRD_PARTY" ? data.vendorId ?? null : null,
      placeId: placeIdOrErr as string | null,
    },
  });
  await logWrite("Warehouse", id, "UPDATE", before, { ...data, placeId: placeIdOrErr });
  revalidatePath("/warehouses");
  revalidatePath("/settings/company-profile");
  return { ok: true };
}

export async function deleteWarehouse(id: string): Promise<Result> {
  await requireAdmin();
  const before = await prisma.warehouse.findUnique({ where: { id } });
  if (!before) return { error: "Warehouse not found" };
  await prisma.warehouse.delete({ where: { id } });
  await logWrite("Warehouse", id, "DELETE", before, null);
  revalidatePath("/warehouses");
  return { ok: true };
}
