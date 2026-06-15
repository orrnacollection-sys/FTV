"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toast";
import { BookCheck } from "lucide-react";
import { postOpeningBalances } from "./actions";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Step 3 trigger — posts the opening-stock totals into the ledger opening
 * balances (Inventory / per-vendor Sundry Creditors / Opening Balance Equity).
 * Idempotent; re-run after any opening-stock re-import.
 */
export function PostOpeningBalances() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  const onClick = () => {
    if (!window.confirm("Post opening stock into the ledger opening balances (Inventory, vendor creditors, Opening Equity)? This overwrites those opening balances.")) return;
    start(async () => {
      const res = await postOpeningBalances();
      if ("error" in res) { toast.error(res.error); return; }
      setDone(`Inventory ${inr(res.inventory)} · Opening Equity (balancing figure) ${inr(res.equity)}`);
      toast.success("Inventory opening posted; books balanced to Opening Equity");
      router.refresh();
    });
  };

  return (
    <div className="card mt-3 p-4">
      <h2 className="font-display text-lg font-bold">Post to accounts <span className="text-xs font-normal text-ink-faint">(Step 3)</span></h2>
      <p className="mt-1 text-xs text-ink-faint">
        Sets the ledger opening balances from the loaded stock — <span className="font-semibold">Inventory</span> (cost),
        each vendor&rsquo;s <span className="font-semibold">pending</span> as Sundry Creditors, and the <span className="font-semibold">paid</span> portion
        as Opening Balance Equity. Cost-only (no fresh ITC). Re-run after any re-import.
      </p>
      <button type="button" onClick={onClick} disabled={busy} className="btn-primary mt-3">
        <BookCheck className="h-4 w-4" /> {busy ? "Posting…" : "Post opening balances"}
      </button>
      {done && (
        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">{done}</div>
      )}
    </div>
  );
}
