"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { customerSchema } from "@/lib/validators/customer";
import { requireEditor } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { ensureCustomerCoA, signedOpening, setSubLedgerOpening } from "@/lib/accounting";
import { getActiveCompanyId } from "@/lib/company";

const MAX_CSV_ROWS = 5000;

type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function rawToObj(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) o[k] = String(v);
  return o;
}

/** Write the form's opening balance (amount + Dr/Cr) to the customer's Sundry
 *  Debtors sub-ledger. Customer accounts are debit-natured (ASSET). */
async function applyCustomerOpening(fd: FormData, accountId: string) {
  const amt = Number(fd.get("openingBalance") ?? 0) || 0;
  const drCr = String(fd.get("openingType") ?? "DR").toUpperCase() === "CR" ? "CR" : "DR";
  await setSubLedgerOpening(accountId, signedOpening("ASSET", amt, drCr));
}

export async function createCustomer(fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = customerSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }

  let createdId: string | null = null;
  try {
    const companyId = await getActiveCompanyId();
    const created = await prisma.customer.create({
      data: { ...parsed.data, companyId },
    });
    createdId = created.id;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "A customer with this email or code already exists" };
    }
    return { ok: false, error: "Failed to create customer" };
  }
  if (createdId) {
    await logWrite("Customer", createdId, "CREATE", null, parsed.data);
    // #125 — auto-create the paired CoA sub-ledger under Sundry Debtors.
    // Idempotent helper; failure is logged but does NOT roll back the
    // Customer create (operational ops shouldn't block on accounting).
    const coaRes = await ensureCustomerCoA(createdId);
    if ("error" in coaRes) {
      console.error(`[customer.create] CoA auto-create failed: ${coaRes.error}`);
    } else {
      await applyCustomerOpening(fd, coaRes.accountId);
    }
  }
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(id: string, fd: FormData): Promise<ActionResult> {
  await requireEditor();
  const parsed = customerSchema.safeParse(rawToObj(fd));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Validation failed",
      fieldErrors: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""]),
      ),
    };
  }
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Customer not found" };

  try {
    await prisma.customer.update({ where: { id }, data: { ...parsed.data } });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "A customer with this email or code already exists" };
    }
    return { ok: false, error: "Failed to update customer" };
  }
  await logWrite("Customer", id, "UPDATE", before, parsed.data);
  // Keep the opening balance on the customer's sub-ledger in sync.
  const coaRes = await ensureCustomerCoA(id);
  if (!("error" in coaRes)) await applyCustomerOpening(fd, coaRes.accountId);
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  redirect("/customers");
}

export async function deleteCustomer(id: string): Promise<void> {
  await requireEditor();
  const before = await prisma.customer.findUnique({ where: { id } });
  await prisma.customer.delete({ where: { id } });
  if (before) await logWrite("Customer", id, "DELETE", before, null);
  revalidatePath("/customers");
}

export async function bulkImportCustomers(rows: Record<string, string>[], confirmOverwrite = false) {
  await requireEditor();
  if (rows.length > MAX_CSV_ROWS) {
    return { created: 0, updated: 0, errors: [`Batch too large — max ${MAX_CSV_ROWS} rows`] };
  }
  const companyId = await getActiveCompanyId();

  // Overwrite guard — match incoming rows to existing customers by email.
  const incomingEmails = [
    ...new Set(rows.map((r) => (r.email ?? r.Email ?? "").trim().toLowerCase()).filter(Boolean)),
  ];
  const overwriteCount = incomingEmails.length
    ? await prisma.customer.count({ where: { companyId, email: { in: incomingEmails } } })
    : 0;
  if (overwriteCount > 0 && !confirmOverwrite) {
    return { created: 0, updated: 0, errors: [], needsConfirm: true, overwriteCount };
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const data = {
      name: r.name ?? r.Name ?? "",
      code: r.code ?? r.Code ?? r["Customer Code"] ?? "",
      email: r.email ?? r.Email ?? "",
      mobile: r.mobile ?? r.Mobile ?? r.phone ?? r.Phone ?? "",
      whatsapp: r.whatsapp ?? r.Whatsapp ?? r.WhatsApp ?? "",
      gst: r.gst ?? r.GST ?? "",
      gstRegType: (r.gstRegType ?? r["GST Reg Type"] ?? r["Registration Type"] ?? "").toUpperCase() || "UNREGISTERED",
      pan: r.pan ?? r.PAN ?? "",
      bankName: r.bankName ?? r["Bank Name"] ?? "",
      accountNo: r.accountNo ?? r["Account No"] ?? r.account ?? "",
      ifsc: r.ifsc ?? r.IFSC ?? "",
      address: r.address ?? r.Address ?? "",
      city: r.city ?? r.City ?? "",
      state: r.state ?? r.State ?? "",
      pincode: r.pincode ?? r.Pincode ?? r.PIN ?? r.pin ?? "",
      country: r.country ?? r.Country ?? "",
      priceTier: (r.priceTier ?? r["Price Tier"] ?? "RETAIL").toUpperCase(),
      creditLimit: r.creditLimit ?? r["Credit Limit"] ?? "",
      paymentTermsDays: r.paymentTermsDays ?? r["Payment Terms"] ?? r.terms ?? "0",
      salesRep: r.salesRep ?? r["Sales Rep"] ?? "",
      status: (r.status ?? r.Status ?? "ACTIVE").toUpperCase(),
    };
    const parsed = customerSchema.safeParse(data);
    if (!parsed.success) {
      errors.push(
        `Row "${data.name || "?"}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
      continue;
    }
    try {
      const existing = parsed.data.email
        ? await prisma.customer.findUnique({ where: { email: parsed.data.email } })
        : null;
      if (existing) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: { ...parsed.data, code: parsed.data.code ?? existing.code },
        });
        updated++;
      } else {
        const companyId = await getActiveCompanyId();
        await prisma.customer.create({ data: { ...parsed.data, companyId } });
        created++;
      }
    } catch {
      errors.push(`Row "${data.name}": save failed`);
    }
  }
  revalidatePath("/customers");
  return { created, updated, errors };
}
