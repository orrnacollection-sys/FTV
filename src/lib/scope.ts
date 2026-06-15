/**
 * Multi-company query-scoping helpers (#135).
 *
 * Every operational table (Vendor, Item, GRN, MarketplaceOrder, etc.)
 * has a `companyId` column. **Reads must filter by it** and **writes
 * must stamp it** so a vendor entered in Company A never shows up
 * inside Company B.
 *
 * The Tally model: each company is an independent book. The active
 * company comes from the `ftv-active-company` cookie; the topbar
 * switcher writes it.
 *
 * # Hygiene rules for any new code that touches operational data
 *
 *   1. For a **page** that lists operational rows, the first line of
 *      the component must be `const where = await companyWhere();`.
 *      Pass that into the `where` clause of every `findMany`,
 *      `findFirst`, `count`, `aggregate`, or `groupBy` call.
 *
 *   2. For a **server action** that creates an operational row, the
 *      first line of the action must be `const companyId = await
 *      getActiveCompanyId();`. Include `companyId` in the `data:` of
 *      every `prisma.X.create(...)`.
 *
 *   3. For a **library function** that takes data from one company's
 *      books, pass the resolved companyId in explicitly — don't read
 *      the cookie deep in library code. Library = pure; cookie =
 *      request-scoped. (Existing `getActiveCompanyId()` and
 *      `companyWhere()` are the only library functions allowed to
 *      read cookies, by convention.)
 *
 *   4. Cross-company helpers (the switcher, the companies list, ops
 *      tools that compare across companies) are the *only* legal
 *      exceptions. They must be in `src/app/(admin)/companies/` or
 *      `src/lib/company.ts` and clearly named.
 *
 * Stop sign for code review: if you see a `prisma.X.findMany`,
 * `prisma.X.create`, or `prisma.X.update` on an operational table in
 * a new file and there is *no* mention of `companyId` or `companyWhere`
 * nearby, that's a multi-company leak — block the merge.
 */
import { getActiveCompanyId } from "@/lib/company";

/**
 * The canonical `where` fragment for the active company. Merge it
 * into any operational query:
 *
 *   const vendors = await prisma.vendor.findMany({
 *     where: { ...(await companyWhere()), status: "ACTIVE" },
 *   });
 *
 * Or, more readably:
 *
 *   const scope = await companyWhere();
 *   const vendors = await prisma.vendor.findMany({
 *     where: { ...scope, status: "ACTIVE" },
 *   });
 */
export async function companyWhere(): Promise<{ companyId: string }> {
  const companyId = await getActiveCompanyId();
  return { companyId };
}
