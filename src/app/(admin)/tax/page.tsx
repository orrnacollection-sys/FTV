import { redirect } from "next/navigation";

/** Group-root redirect — `/tax` lands on HSN Rates so the Tax Master
 *  sidebar header doesn't 404 when clicked / typed. */
export default function TaxIndex() {
  redirect("/tax/hsn-rates");
}
