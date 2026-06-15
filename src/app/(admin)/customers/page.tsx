import { prisma } from "@/lib/db";
import { getActiveCompanyId } from "@/lib/company";
import { NewButton } from "@/components/NewButton";
import { CustomerTable } from "./CustomerTable";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  const q = sp?.q?.trim();
  const status = sp?.status?.trim();
  const tier = sp?.tier?.trim();
  const companyId = await getActiveCompanyId();

  const customers = await prisma.customer.findMany({
    where: {
      companyId,
      ...(status ? { status } : {}),
      ...(tier ? { priceTier: tier } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q } },
              { name: { contains: q } },
              { gst: { contains: q } },
              { email: { contains: q } },
              { mobile: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Customer Master</h1>
          <p className="text-sm text-ink-faint">
            {customers.length} customer{customers.length === 1 ? "" : "s"}
          </p>
        </div>
        <NewButton href="/customers/new" label="+ New customer" />
      </div>
      <CustomerTable
        customers={customers}
        initialQuery={q ?? ""}
        initialStatus={status ?? ""}
        initialTier={tier ?? ""}
      />
    </div>
  );
}
