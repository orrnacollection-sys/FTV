"use client";
import { useRouter } from "next/navigation";

export type ModelOpt = { code: string; label: string; basis?: string };

/**
 * Always-visible model filter buttons. Greys out models with no data in the
 * current view (showing ∅) so "absence" is visible at a glance rather than
 * inferred from a missing dropdown option. Clicking is instant — the URL
 * `model` query param is updated and the page re-renders.
 */
export function ModelFilterButtons({
  allModels,
  modelsWithData,
  current,
  paramKey = "model",
  allLabel = "All",
  showBasis = false,
}: {
  allModels: ModelOpt[];
  modelsWithData: string[];
  current: string;
  paramKey?: string;
  allLabel?: string;
  /** Show the model's basis suffix (e.g. "· GRN+term") next to its code. */
  showBasis?: boolean;
}) {
  const router = useRouter();
  const dataSet = new Set(modelsWithData);

  const set = (model: string) => {
    const url = new URL(window.location.href);
    if (model) url.searchParams.set(paramKey, model);
    else url.searchParams.delete(paramKey);
    router.push(url.pathname + url.search);
  };

  const cls = (active: boolean, hasData: boolean) =>
    active
      ? "rounded-full bg-brand-black px-3 py-1 text-xs font-bold text-white"
      : hasData
        ? "rounded-full bg-brand-yellow-pale px-3 py-1 text-xs font-bold text-brand-yellow-dark hover:bg-brand-yellow-light"
        : "rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-faint hover:bg-brand-yellow-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mr-1">Model</span>
      <button type="button" onClick={() => set("")} className={cls(!current, true)}>{allLabel}</button>
      {allModels.map((m) => {
        const hasData = dataSet.has(m.code);
        const active = current === m.code;
        return (
          <button
            key={m.code}
            type="button"
            onClick={() => set(m.code)}
            className={cls(active, hasData)}
            title={hasData ? m.label : `${m.label} — no data in current view`}
          >
            {m.code.replace(/_/g, "-")}
            {showBasis && m.basis ? <span className="ml-1 opacity-70">· {m.basis === "ON_GRN" ? "GRN+term" : "on sale"}</span> : null}
            {!active && !hasData && <span className="ml-1 text-ink-faint">∅</span>}
          </button>
        );
      })}
    </div>
  );
}
