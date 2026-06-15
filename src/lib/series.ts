import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import type { Prisma } from "@prisma/client";

/** Per-docType defaults used when a brand-new company hits a series
 *  for the first time. Keeps the prefix consistent across companies. */
const DEFAULTS: Record<string, { prefix: string; padding: number }> = {
  PO: { prefix: "PO-", padding: 5 },
  GRN: { prefix: "GRN-", padding: 5 },
  INV: { prefix: "INV-", padding: 5 },
  JV: { prefix: "JV-", padding: 5 },
  BT: { prefix: "BT-", padding: 5 },
  WAREHOUSE: { prefix: "WH-", padding: 3 },
  OPENING: { prefix: "OPS", padding: 3 }, // opening-stock GRNs → OPS001, OPS002, …
  TR: { prefix: "TR-", padding: 4 },
  OC: { prefix: "OC-", padding: 4 },
  DN: { prefix: "DN-", padding: 4 },
  CN: { prefix: "CN-", padding: 4 },
  SA: { prefix: "SA-", padding: 4 },
  ORP: { prefix: "ORP-", padding: 5 },
  LEDGER: { prefix: "LED-", padding: 4 },
};

/**
 * Atomically claim the next document number for a series (PO / GRN /
 * INV / …) scoped to the **active company** (#134). Each company has
 * its own counter, so PO-00001 starts fresh in every new company.
 *
 * If the series row doesn't exist yet for this company, it's auto-
 * created with the docType's default prefix + padding.
 *
 * Pass a Prisma transaction client when calling from inside
 * `prisma.$transaction` so the increment shares its atomicity.
 */
export async function nextDocNumber(
  docType: string,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const client = tx ?? prisma;
  const companyId = await getActiveCompanyId();

  let series = await client.series.findUnique({
    where: { companyId_docType: { companyId, docType } },
  });

  if (!series) {
    const fallback = DEFAULTS[docType];
    if (!fallback) throw new Error(`Unknown series: ${docType}`);
    series = await client.series.create({
      data: {
        companyId,
        docType,
        prefix: fallback.prefix,
        nextNumber: 1,
        padding: fallback.padding,
      },
    });
  }

  const claimed = await client.series.update({
    where: { companyId_docType: { companyId, docType } },
    data: { nextNumber: { increment: 1 } },
  });
  const num = claimed.nextNumber - 1;
  return `${series.prefix}${String(num).padStart(series.padding, "0")}`;
}
