import { redirect } from "next/navigation";

/** Group-root redirect — `/accounting` lands on the first leaf so the
 *  Accounting sidebar header doesn't 404 when clicked / typed. */
export default function AccountingIndex() {
  redirect("/accounting/chart");
}
