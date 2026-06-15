import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import { isAdminRole } from "@/lib/constants";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { LicenseBanner } from "@/components/LicenseBanner";
import { ShortcutProvider } from "@/components/ShortcutContext";
import { ShortcutCheatsheet } from "@/components/ShortcutCheatsheet";
import { EscapeBackNav } from "@/components/EscapeBackNav";
import { MobileNavProvider } from "@/components/MobileNavContext";
import { GlobalSearchShortcut } from "@/components/GlobalSearchShortcut";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (!isAdminRole(me.role)) redirect("/portal");

  return (
    <MobileNavProvider>
      <ShortcutProvider>
        <EscapeBackNav />
        <GlobalSearchShortcut />
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <Topbar />
            <LicenseBanner />
            <main className="flex-1 px-4 py-4 md:px-6 md:py-6 animate-in fade-in duration-300">{children}</main>
          </div>
        </div>
        <ShortcutCheatsheet />
      </ShortcutProvider>
    </MobileNavProvider>
  );
}
