import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import { isVendorRole } from "@/lib/constants";
import { VendorSidebar } from "@/components/VendorSidebar";
import { Topbar } from "@/components/Topbar";
import { ShortcutProvider } from "@/components/ShortcutContext";
import { ShortcutCheatsheet } from "@/components/ShortcutCheatsheet";
import { EscapeBackNav } from "@/components/EscapeBackNav";
import { MobileNavProvider } from "@/components/MobileNavContext";
import { GlobalSearchShortcut } from "@/components/GlobalSearchShortcut";

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (!isVendorRole(me.role)) redirect("/dashboard");
  if (!me.vendorId) redirect("/login");

  return (
    <MobileNavProvider>
      <ShortcutProvider>
        <EscapeBackNav home="/portal" />
        <GlobalSearchShortcut />
        <div className="flex min-h-screen">
          <VendorSidebar role={me.role} />
          <div className="flex flex-1 flex-col min-w-0">
            <Topbar />
            <main className="flex-1 px-4 py-4 md:px-6 md:py-6 animate-in fade-in duration-300">{children}</main>
          </div>
        </div>
        <ShortcutCheatsheet />
      </ShortcutProvider>
    </MobileNavProvider>
  );
}
