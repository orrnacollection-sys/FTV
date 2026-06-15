"use client";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShortcut } from "@/hooks/useShortcut";

/**
 * Lowest-priority "go back" handler. Mounted once in the admin layout so it
 * fires only when no form / modal / dropdown above us has consumed the key.
 *
 * Both **Esc** and **Backspace** climb one level — Tally's universal back keys.
 * They are registered as no-modifier chords, so the ShortcutProvider only fires
 * them when the user is NOT typing in a field. That means Backspace still
 * deletes characters inside an input/textarea and only navigates back when
 * focus is on the page chrome (a list, a row cursor, the body) — never eating
 * a keystroke mid-entry.
 *
 * Ladder:
 *   • on /dashboard → no-op (already at the top)
 *   • on a list page like /vendors, /items → go to /dashboard AND broadcast a
 *     collapse signal so Sidebar shrinks all groups.
 *   • on a detail / sub-page like /vendors/[id]/review → climb one segment.
 *
 * Mount must happen at the LAYOUT level so this is the first useShortcut to
 * register and therefore the LAST to fire (handlers walk newest→oldest).
 */
export function EscapeBackNav({ home = "/dashboard" }: { home?: string }) {
  const router = useRouter();
  const path = usePathname() ?? home;
  // For vendors, "home" is /portal — climbing from /portal/ledger should land
  // there. The home depth tells us when we're already at a top-level list.
  const homeDepth = home.split("/").filter(Boolean).length;

  const goBack = useCallback(() => {
    // Already at home → no-op.
    if (path === home || path === "/") return;

    const segments = path.split("/").filter(Boolean);
    // Top-level list (e.g. /vendors when home is /dashboard) → jump to home and
    // collapse the sidebar groups.
    if (segments.length <= Math.max(1, homeDepth)) {
      window.dispatchEvent(new CustomEvent("ftv:sidebar-collapse"));
      router.push(home);
      return;
    }
    // Detail / sub-page → climb one segment.
    router.push("/" + segments.slice(0, -1).join("/"));
  }, [path, home, homeDepth, router]);

  useShortcut("escape", goBack, { label: "Back", group: "Navigation" });
  useShortcut("backspace", goBack, { label: "Back", group: "Navigation" });

  return null;
}
