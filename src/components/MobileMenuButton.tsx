"use client";
import { Menu } from "lucide-react";
import { useMobileNav } from "@/components/MobileNavContext";

export function MobileMenuButton() {
  const { toggleMobile } = useMobileNav();
  return (
    <button
      type="button"
      onClick={toggleMobile}
      aria-label="Open menu"
      className="md:hidden inline-flex items-center justify-center rounded p-2 text-ink-mid hover:bg-surface-gray-100"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
