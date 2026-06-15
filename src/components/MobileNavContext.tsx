"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Mobile drawer state for the admin shell. Below md the Sidebar slides in
 * over the page; above md the Sidebar is a normal column and this state is
 * unused.
 */
type Ctx = {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  toggleMobile: () => void;
};

const MobileNavCtx = createContext<Ctx | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), []);

  // Body scroll lock while the drawer is open.
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  return (
    <MobileNavCtx.Provider value={{ mobileOpen, setMobileOpen, toggleMobile }}>
      {children}
    </MobileNavCtx.Provider>
  );
}

export function useMobileNav(): Ctx {
  const v = useContext(MobileNavCtx);
  if (!v) throw new Error("useMobileNav must be used inside <MobileNavProvider>");
  return v;
}
