"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { toDisplayDate } from "@/lib/date";
import { MODEL_LABELS, type Model } from "@/lib/constants";
import { ImagePopup } from "../../items/ImagePopup";
import { closePO, deletePO, emailPO } from "../actions";
import { Download, Mail, MessageCircle, X, ChevronLeft, Trash2, ExternalLink, Pencil } from "lucide-react";

type Item = {
  id: string;
  skuCode: string;
  name: string;
  hsn: string | null;
  model: string;
  imageUrl: string | null;
  qty: number;
  rate: number;
  taxRate: number;
  total: number;
  receivedQty: number;
};

export function POView({
  po,
  org,
  vendor,
  items,
  totals,
}: {
  po: {
    id: string;
    poNumber: string;
    poDate: Date;
    dueDate: Date | null;
    status: string;
    notes: string | null;
    total: number;
    isDraft: boolean;
  };
  org: {
    name: string;
    addressLine: string;
    gst: string | null;
  };
  vendor: {
    code: string;
    name: string;
    email: string | null;
    whatsapp: string | null;
    gst: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  items: Item[];
  totals: { subtotal: number; tax: number; qty: number; received: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);

  const pdfHref = `/api/po/${po.id}/pdf`;

  const onEmail = () => {
    startTransition(async () => {
      const res = await emailPO(po.id);
      if ("error" in res) toast.error(res.error);
      else toast.success("Email queued (see server console in dev)");
    });
  };

  const onClose = () => {
    if (!window.confirm(`Close PO ${po.poNumber}?`)) return;
    startTransition(async () => {
      const res = await closePO(po.id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Closed"); router.refresh(); }
    });
  };

  const onDelete = () => {
    if (!window.confirm(`Delete PO ${po.poNumber}? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deletePO(po.id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Deleted"); router.push("/purchase-orders"); }
    });
  };

  const whatsAppHref = vendor.whatsapp
    ? `https://wa.me/${vendor.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hi ${vendor.name}, sending you Purchase Order ${po.poNumber} dated ${toDisplayDate(po.poDate)}. Total: ${po.total.toFixed(2)}. Please confirm.`,
      )}`
    : null;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link href="/purchase-orders" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
            <ChevronLeft className="h-3 w-3" /> Back to list
          </Link>
          <h1 className="font-display text-3xl font-bold mt-1">{po.poNumber}</h1>
          <p className="text-sm text-ink-faint">
            {toDisplayDate(po.poDate)}{po.dueDate ? ` · Due ${toDisplayDate(po.dueDate)}` : ""}
            {" · "}
            <span className="badge border-brand-yellow-light bg-brand-yellow-50">{po.status.replace("_", " ")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {po.status !== "CANCELLED" && (
            <Link href={`/purchase-orders/${po.id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          )}
          <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <Download className="h-4 w-4" /> PDF
          </a>
          <button type="button" onClick={onEmail} disabled={pending || !vendor.email} className="btn-secondary" title={vendor.email ? "Email vendor (CC admin)" : "Vendor has no email"}>
            <Mail className="h-4 w-4" /> Email
          </button>
          {whatsAppHref ? (
            <a href={whatsAppHref} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          ) : (
            <button type="button" disabled className="btn-secondary" title="Vendor has no WhatsApp number">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </button>
          )}
          {po.status !== "CLOSED" && (
            <button type="button" onClick={onClose} disabled={pending} className="btn-secondary">
              <X className="h-4 w-4" /> Close PO
            </button>
          )}
          <button type="button" onClick={onDelete} disabled={pending} className="btn-danger">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mb-2">From</div>
          <div className="font-display text-lg font-bold">{org.name}</div>
          {org.addressLine && <div className="text-sm text-ink-mid mt-1">{org.addressLine}</div>}
          {org.gst && <div className="text-sm text-ink-mid">GSTIN: {org.gst}</div>}
        </div>
        <div className="card p-5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mb-2">Vendor</div>
          <div className="font-display text-lg font-bold">{vendor.name}</div>
          <div className="text-sm text-ink-mid mt-1">Code: {vendor.code}</div>
          {vendor.gst && <div className="text-sm text-ink-mid">GST: {vendor.gst}</div>}
          {vendor.address && <div className="text-sm text-ink-mid">{vendor.address}</div>}
          {(vendor.city || vendor.state || vendor.pincode) && (
            <div className="text-sm text-ink-mid">
              {[vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(", ")}
            </div>
          )}
          {vendor.email && <div className="text-sm text-ink-mid">{vendor.email}</div>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">
          Items
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th w-14">Img</th>
                <th className="th">SKU</th>
                <th className="th">Name</th>
                <th className="th">HSN</th>
                <th className="th">Model</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Pending</th>
                <th className="th text-right">Rate</th>
                <th className="th text-right">GST %</th>
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="td">
                    {i.imageUrl ? (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setPreview({ src: i.imageUrl!, alt: i.name })} className="block rounded border border-border overflow-hidden hover:ring-2 hover:ring-brand-yellow-dark">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={i.imageUrl} alt={i.name} className="h-10 w-10 object-cover" />
                        </button>
                        <a href={i.imageUrl} target="_blank" rel="noopener noreferrer" className="rounded p-1 hover:bg-brand-yellow-pale" title="Open in new tab">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ) : <div className="h-10 w-10 rounded border border-dashed border-border" />}
                  </td>
                  <td className="td font-mono text-xs">{i.skuCode}</td>
                  <td className="td">{i.name}</td>
                  <td className="td font-mono text-xs">{i.hsn ?? "—"}</td>
                  <td className="td">{MODEL_LABELS[i.model as Model] ?? i.model}</td>
                  <td className="td text-right tabular-nums">{i.qty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{i.receivedQty.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">
                    {i.qty - i.receivedQty > 0 ? <span className="font-bold text-amber-700">{(i.qty - i.receivedQty).toFixed(2)}</span> : "—"}
                  </td>
                  <td className="td text-right tabular-nums">{i.rate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums">{i.taxRate.toFixed(2)}</td>
                  <td className="td text-right tabular-nums font-medium">{i.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-border p-4">
          <div className="text-sm space-y-1 text-right">
            <div>Subtotal <span className="ml-6 tabular-nums">{totals.subtotal.toFixed(2)}</span></div>
            <div>GST <span className="ml-6 tabular-nums">{totals.tax.toFixed(2)}</span></div>
            <div className="font-display text-xl font-bold border-t border-border pt-1">Total <span className="ml-6 tabular-nums">{(totals.subtotal + totals.tax).toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      {po.notes && (
        <div className="card p-5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint mb-2">Notes</div>
          <div className="text-sm">{po.notes}</div>
        </div>
      )}

      {preview && <ImagePopup src={preview.src} alt={preview.alt} onClose={() => setPreview(null)} />}
    </div>
  );
}
