"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShortcut } from "@/hooks/useShortcut";
import { Kbd } from "@/components/Kbd";

/**
 * Primary "create new" button carrying the Tally-canonical **Alt+C = Create**
 * shortcut. Drop it on every list page that has a "New …" action so Create is
 * always keyboard-reachable (no mouse). The shortcut fires even while typing in
 * a field (it has a modifier), matching Tally's always-available Alt+C.
 *
 *   <NewButton href="/vendors/new" label="+ New vendor" />
 *
 * Pass `chord` to override (e.g. a page with two create actions).
 */
export function NewButton({
  href,
  label,
  chord = "alt+c",
  className = "btn-primary",
}: {
  href: string;
  label: string;
  chord?: string;
  className?: string;
}) {
  const router = useRouter();
  useShortcut(chord, () => router.push(href), { label, group: "Create" });
  return (
    <Link href={href} className={className}>
      {label} <Kbd chord={chord} className="ml-1" />
    </Link>
  );
}
