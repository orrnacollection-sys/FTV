import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import { isAdminRole } from "@/lib/constants";

export default async function Home() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  redirect(isAdminRole(me.role) ? "/dashboard" : "/portal");
}
