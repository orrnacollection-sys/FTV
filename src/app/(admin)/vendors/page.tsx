import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { VendorTable } from "./VendorTable";
import { NewButton } from "@/components/NewButton";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const status = sp?.status?.trim();
  const companyId = await getActiveCompanyId();

  const vendors = await prisma.vendor.findMany({
    where: {
      companyId,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q } },
              { name: { contains: q } },
              { gst: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const pendingCount = await prisma.vendor.count({ where: { companyId, status: "PENDING" } });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Vendor Master</h1>
          <p className="text-sm text-ink-faint">
            {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
            {pendingCount > 0 && !status && (
              <> · <Link href="/vendors?status=PENDING" className="text-amber-700 font-bold hover:underline">{pendingCount} pending application{pendingCount === 1 ? "" : "s"} →</Link></>
            )}
          </p>
        </div>
        <NewButton href="/vendors/new" label="+ New vendor" />
      </div>
      <VendorTable vendors={vendors} initialQuery={q ?? ""} initialStatus={status ?? ""} />
    </div>
  );
}
