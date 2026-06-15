"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { Trash2, Plus } from "lucide-react";
import { allocateReceipt, removeAllocation } from "../../actions";

type Existing = {
  id: string;
  amount: number;
  allocatedAt: string;
  order: {
    id: string;
    invoiceNo: string | null;
    date: string;
    total: number;
    marketplace: string;
    channel: string;
    customerName: string | null;
  };
};

type Candidate = {
  id: string;
  invoiceNo: string | null;
  date: string;
  total: number;
  outstanding: number;
  customerName: string | null;
  marketplace: string;
  channel: string;
};

export function AllocationPanel({
  txnId,
  customerName,
  unallocated,
  existing,
  candidates,
}: {
  txnId: string;
  customerName: string | null;
  unallocated: number;
  existing: Existing[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  function add(orderId: string, amount: number) {
    startTransition(async () => {
      const r = await allocateReceipt({ bankTransactionId: txnId, orderId, amount });
      if (!("ok" in r) || !r.ok) {
        toast.error("error" in r ? r.error : "Allocation failed");
        return;
      }
      toast.success(`Allocated ₹${amount.toFixed(2)}`);
      setPickerOpen(false);
      router.refresh();
    });
  }

  function remove(allocationId: string) {
    startTransition(async () => {
      const r = await removeAllocation(allocationId);
      if (!("ok" in r) || !r.ok) {
        toast.error("error" in r ? r.error : "Delete failed");
        return;
      }
      toast.success("Allocation removed");
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-2">
        <span className="text-sm font-bold">Order Allocations</span>
        {customerName && <span className="text-xs text-ink-mid">· {customerName}</span>}
        <button
          onClick={() => setPickerOpen(true)}
          className="ml-auto btn-primary text-xs py-1 px-2 flex items-center gap-1"
          disabled={busy || unallocated <= 0.01}
          title={unallocated <= 0.01 ? "Fully allocated" : "Add allocation"}
        >
          <Plus className="h-3.5 w-3.5" /> Allocate to Order
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Invoice / Order</th>
            <th className="th">Date</th>
            <th className="th">Channel</th>
            <th className="th text-right">Order Total</th>
            <th className="th text-right">Allocated</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {existing.length === 0 ? (
            <tr><td colSpan={6} className="td text-center py-6 text-ink-faint">No allocations yet. Click &ldquo;Allocate to Order&rdquo;.</td></tr>
          ) : (
            existing.map((a) => (
              <tr key={a.id} className="hover:bg-brand-yellow-50/40">
                <td className="td">
                  <div className="font-mono text-xs">{a.order.invoiceNo ?? `Order ${a.order.id.slice(-6)}`}</div>
                  {a.order.customerName && <div className="text-xs text-ink-mid">{a.order.customerName}</div>}
                </td>
                <td className="td text-xs">{fmtDate(a.order.date)}</td>
                <td className="td text-xs">{a.order.marketplace}</td>
                <td className="td text-right font-mono">₹{a.order.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                <td className="td text-right font-mono font-bold text-emerald-700">₹{a.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                <td className="td text-right">
                  <button onClick={() => remove(a.id)} className="rounded p-1 hover:bg-rose-50" title="Remove allocation" disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {pickerOpen && (
        <PickerModal
          candidates={candidates}
          unallocated={unallocated}
          onClose={() => setPickerOpen(false)}
          onPick={add}
        />
      )}
    </div>
  );
}

function PickerModal({
  candidates,
  unallocated,
  onClose,
  onPick,
}: {
  candidates: Candidate[];
  unallocated: number;
  onClose: () => void;
  onPick: (orderId: string, amount: number) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  function setAmount(orderId: string, v: string) {
    setAmounts((s) => ({ ...s, [orderId]: v }));
  }

  function pickFull(o: Candidate) {
    const amount = Math.min(o.outstanding, unallocated);
    onPick(o.id, amount);
  }

  function pickCustom(o: Candidate) {
    const raw = amounts[o.id];
    const amt = Number(raw);
    if (!amt || amt <= 0) {
      return;
    }
    onPick(o.id, amt);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="card max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="border-b border-border bg-brand-yellow-pale/60 px-4 py-2 flex items-center gap-2">
          <span className="text-sm font-bold">Pick an outstanding order</span>
          <span className="text-xs text-ink-mid ml-auto">Unallocated balance: ₹{unallocated.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          <button onClick={onClose} className="ml-2 text-xs text-ink-mid hover:text-ink">Esc</button>
        </div>
        <div className="overflow-auto flex-1">
          {candidates.length === 0 ? (
            <div className="p-6 text-center text-ink-mid text-sm">
              No outstanding orders for this customer.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="th">Invoice / Order</th>
                  <th className="th">Date</th>
                  <th className="th">Channel · Marketplace</th>
                  <th className="th">Customer</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Outstanding</th>
                  <th className="th text-right">Custom Amt</th>
                  <th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((o) => (
                  <tr key={o.id} className="hover:bg-brand-yellow-50/40">
                    <td className="td font-mono">{o.invoiceNo ?? `Order ${o.id.slice(-6)}`}</td>
                    <td className="td">{fmtDate(o.date)}</td>
                    <td className="td">{o.channel} · {o.marketplace}</td>
                    <td className="td">{o.customerName ?? "—"}</td>
                    <td className="td text-right font-mono">₹{o.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="td text-right font-mono font-bold text-amber-700">₹{o.outstanding.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="td text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={Math.min(o.outstanding, unallocated).toFixed(2)}
                        value={amounts[o.id] ?? ""}
                        onChange={(e) => setAmount(o.id, e.target.value)}
                        className="input text-right font-mono w-24 text-xs"
                      />
                    </td>
                    <td className="td text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => pickFull(o)} className="btn-primary text-xs py-0.5 px-2" title="Allocate the lesser of outstanding & unallocated">Full</button>
                        {amounts[o.id] && <button onClick={() => pickCustom(o)} className="btn-ghost text-xs py-0.5 px-2">Custom</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}
