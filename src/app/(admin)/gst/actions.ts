"use server";
import { requireAdmin } from "@/lib/rbac";
import { buildGSTR1, gstr1ToPortalJson, type GSTR1Report } from "@/lib/gst/gstr1";

/** Server action: regenerate the GSTR-1 report for a period + GSTIN.
 *  Returns the structured report — page hands it to the client view. */
export async function generateGSTR1(
  period: string,
  gstin?: string,
): Promise<{ ok: true; report: GSTR1Report } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const report = await buildGSTR1({ period, gstin });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to build GSTR-1" };
  }
}

/** Server action: export GSTR-1 as portal-shaped JSON. Returns the JSON
 *  string — client downloads it as a file. */
export async function exportGSTR1Json(
  period: string,
  gstin?: string,
): Promise<{ ok: true; filename: string; json: string } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const report = await buildGSTR1({ period, gstin });
    const payload = gstr1ToPortalJson(report);
    const filename = `GSTR1_${report.gstin}_${report.fp}.json`;
    return { ok: true, filename, json: JSON.stringify(payload, null, 2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to export JSON" };
  }
}
