import { redirect } from "next/navigation";

/** Group-root redirect — `/banking` lands on the first leaf so the
 *  Banking sidebar header doesn't 404 when clicked / typed. */
export default function BankingIndex() {
  redirect("/banking/accounts");
}
