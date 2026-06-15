import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { CustomerForm } from "../CustomerForm";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const customer = await prisma.customer.findFirst({
    where: { id, companyId },
    include: { ledger: { select: { openingBalance: true } } },
  });
  if (!customer) notFound();

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-bold">Edit Customer</h1>
      <p className="text-sm text-ink-faint mb-6">
        {customer.code ? `${customer.code} · ` : ""}{customer.name}
      </p>
      <CustomerForm initial={{ ...customer, opening: customer.ledger?.openingBalance ?? 0 }} />
    </div>
  );
}
