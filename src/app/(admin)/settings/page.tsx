import { redirect } from "next/navigation";

/** Group-root redirect — `/settings` lands on Company Profile so the
 *  Settings sidebar header doesn't 404 when clicked / typed. */
export default function SettingsIndex() {
  redirect("/settings/company-profile");
}
