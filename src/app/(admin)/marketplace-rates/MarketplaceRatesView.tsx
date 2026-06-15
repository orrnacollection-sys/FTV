"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { saveMarketplaceRate, deleteMarketplaceRate } from "./actions";
import { Percent, Plus, Trash2 } from "lucide-react";

type Rate = { id: string; marketplace: string; commissionPct: number; logisticsPct: number };

export function MarketplaceRatesView({ rates }: { rates: Rate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [marketplace, setMarketplace] = useState("");
  const [commissionPct, setCommissionPct] = useState("");
  const [logisticsPct, setLogisticsPct] = useState("");

  const onSave = (mkt: string, comm: string, logi: string) => {
    if (!mkt.trim()) { toast.error("Marketplace name required"); return; }
    start(async () => {
      const res = await saveMarketplaceRate({
        marketplace: mkt,
        commissionPct: parseFloat(comm) || 0,
        logisticsPct: parseFloat(logi) || 0,
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Saved");
        setMarketplace(""); setCommissionPct(""); setLogisticsPct("");
        router.refresh();
      }
    });
  };

  const onDelete = (id: string, mkt: string) => {
    if (!window.confirm(`Delete rate for ${mkt}?`)) return;
    start(async () => {
      const res = await deleteMarketplaceRate(id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.refresh(); }
    });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">
          <Plus className="h-4 w-4" /> Add / update rate
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input placeholder="Marketplace (e.g. Amazon)" value={marketplace} onChange={(e) => setMarketplace(e.target.value)} className="input" />
          <input type="number" step="0.01" placeholder="Commission %" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className="input sm:w-32" />
          <input type="number" step="0.01" placeholder="Logistics %" value={logisticsPct} onChange={(e) => setLogisticsPct(e.target.value)} className="input sm:w-32" />
          <button type="button" onClick={() => onSave(marketplace, commissionPct, logisticsPct)} disabled={pending} className="btn-primary">Save</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Marketplace</th>
              <th className="th text-right">Commission %</th>
              <th className="th text-right">Logistics %</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 ? (
              <tr>
                <td colSpan={4} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <Percent className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No rates yet. Add one per marketplace above.</div>
                  </div>
                </td>
              </tr>
            ) : (
              rates.map((r) => (
                <tr key={r.id} className="hover:bg-brand-yellow-50/40">
                  <td className="td font-medium">{r.marketplace}</td>
                  <td className="td text-right tabular-nums">{r.commissionPct.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{r.logisticsPct.toFixed(2)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onSave(r.marketplace, String(r.commissionPct), String(r.logisticsPct))}
                        disabled={pending}
                        className="rounded px-2 py-1 text-xs text-ink-mid hover:bg-brand-yellow-pale"
                        title="Re-save (use the form above to change values)"
                      >
                        Resave
                      </button>
                      <button type="button" onClick={() => onDelete(r.id, r.marketplace)} disabled={pending} className="rounded p-1.5 text-red-700 hover:bg-red-50" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
