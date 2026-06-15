import { cn } from "@/lib/utils";

/**
 * Tally-style menu label: underlines the shortcut's mnemonic letter inside the
 * label so the keyboard hint is visible at a glance.
 *
 *   <MnemonicLabel label="Category Master" chord="alt+a" />   →  C<u>a</u>tegory Master
 *
 * The chord's final key (e.g. "a" from "alt+a") is matched case-insensitively
 * against the first occurrence in `label`. If the letter isn't present (or no
 * chord is given) the label renders unchanged.
 *
 * `active` flips the underline colour: on the highlighted (yellow) row the
 * accent yellow would vanish, so we underline in the current text colour
 * instead; everywhere else the letter is drawn in brand-yellow.
 */
export function MnemonicLabel({
  label,
  chord,
  letter: letterProp,
  active = false,
}: {
  label: string;
  chord?: string;
  /** Explicit highlight letter (used for group headers that have no chord). */
  letter?: string;
  active?: boolean;
}) {
  const letter = (letterProp ?? (chord ? chord.split("+").pop()?.trim() : undefined))?.toLowerCase();
  const idx = letter && letter.length === 1 ? label.toLowerCase().indexOf(letter) : -1;
  if (idx < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, idx)}
      <span
        className={cn(
          "font-bold underline decoration-2 underline-offset-2",
          active ? "decoration-current" : "text-brand-yellow decoration-brand-yellow",
        )}
      >
        {label[idx]}
      </span>
      {label.slice(idx + 1)}
    </>
  );
}
