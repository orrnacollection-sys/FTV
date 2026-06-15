"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { logWrite } from "@/lib/audit";
import { activateLicense } from "@/lib/licensing";

export async function activateLicenseAction(fd: FormData): Promise<
  { ok: true } | { ok?: undefined; error: string }
> {
  await requireAdmin();
  const key = String(fd.get("key") ?? "").trim();
  if (!key) return { error: "Paste a license key first." };
  const r = await activateLicense(key);
  if (!("ok" in r) || !r.ok) return { error: "error" in r ? r.error : "Activation failed" };
  await logWrite("License", r.license.id, "UPDATE", null, { plan: r.license.plan, activatedAt: r.license.activatedAt });
  revalidatePath("/", "layout"); // banner + gated routes need re-eval
  return { ok: true };
}
