"use client";
import { useEffect, useRef } from "react";
import { useShortcutCtx } from "@/components/ShortcutContext";

/**
 * Register a keyboard shortcut for as long as the component is mounted.
 *
 *   useShortcut("mod+enter", () => formRef.current?.requestSubmit(), {
 *     label: "Create PO",
 *     group: "Form",
 *   });
 */
export function useShortcut(
  chord: string,
  handler: (e: KeyboardEvent) => void,
  opts?: {
    label?: string;
    group?: string;
    hidden?: boolean;
    fireInInputs?: boolean;
    /** Skip registration entirely (handy for conditional shortcuts). */
    enabled?: boolean;
  },
) {
  const { register } = useShortcutCtx();
  // Keep the latest handler without re-registering on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (opts?.enabled === false) return;
    return register({
      chord,
      label: opts?.label ?? chord,
      group: opts?.group,
      hidden: opts?.hidden,
      fireInInputs: opts?.fireInInputs,
      handler: (e) => handlerRef.current(e),
    });
  }, [chord, opts?.enabled, opts?.label, opts?.group, opts?.hidden, opts?.fireInInputs, register]);
}
