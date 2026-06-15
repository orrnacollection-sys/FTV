import { redirect } from "next/navigation";

/**
 * Legacy route — kept for muscle memory. The Orders unification (#114-116)
 * renamed /marketplace-orders → /orders. Any bookmark or stale link lands
 * here and gets bounced to the new location. Safe to delete this folder
 * once the team has stopped typing the old URL.
 */
export default function MarketplaceOrdersRedirect() {
  redirect("/orders");
}
