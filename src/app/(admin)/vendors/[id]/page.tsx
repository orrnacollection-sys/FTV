import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { VendorForm } from "../VendorForm";

export const dynamic = "force-dynamic";

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const vendor = await prisma.vendor.findFirst({
    where: { id, companyId },
    include: { ledger: { select: { openingBalance: true } } },
  });
  if (!vendor) notFound();

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-bold">Edit Vendor</h1>
      <p className="text-sm text-ink-faint mb-6">{vendor.code} · {vendor.name}</p>
      <VendorForm initial={{ ...vendor, opening: vendor.ledger?.openingBalance ?? 0 }} />
    </div>
  );
}
