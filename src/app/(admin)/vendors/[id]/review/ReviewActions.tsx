"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { approveApplication, approveWithoutInvite, rejectApplication } from "../../actions";
import { Check, X, Copy } from "lucide-react";

export function ReviewActions({
  vendorId,
  vendorName,
  vendorCode,
  hasEmail,
}: {
  vendorId: string;
  vendorName: string;
  vendorCode: string | null;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [generatedInvite, setGeneratedInvite] = useState<string | null>(null);

  const onApprove = () => {
    if (!window.confirm(`Approve ${vendorName}? This activates the vendor and sends an invite email.`)) return;
    startTransition(async () => {
      const res = await approveApplication(vendorId, notes.trim() || undefined);
      if ("error" in res) { toast.error(res.error); return; }
      setGeneratedInvite(res.inviteUrl ?? null);
      toast.success("Approved — invite sent");
      router.refresh();
    });
  };

  const onApproveNoInvite = () => {
    if (!window.confirm(`Approve ${vendorName} without a portal invite? This just activates the vendor — no email is sent.`)) return;
    startTransition(async () => {
      const res = await approveWithoutInvite(vendorId, notes.trim() || undefined);
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("Approved (no invite)");
      router.refresh();
    });
  };

  const onReject = () => {
    if (!notes.trim()) { toast.error("Add notes explaining the rejection"); return; }
    if (!window.confirm(`Reject application from ${vendorName}?`)) return;
    startTransition(async () => {
      const res = await rejectApplication(vendorId, notes.trim());
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("Rejected");
      router.refresh();
    });
  };

  const copyInvite = async () => {
    if (!generatedInvite) return;
    await navigator.clipboard.writeText(generatedInvite);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="card p-5 space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Vendor code</div>
        <div className="mt-1 rounded border-[1.5px] border-border bg-brand-yellow-50 px-3 py-2 font-mono text-sm inline-flex items-center gap-2">
          {vendorCode ? <span className="font-bold tracking-wide">{vendorCode}</span> : <span className="text-ink-faint italic">not set — edit the vendor to add one</span>}
        </div>
        <p className="mt-1 text-[11px] text-ink-faint">Codes are typed manually now. Model is set per item later (Item Master).</p>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-ink-faint">Review notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes shown on the vendor record. Required when rejecting."
          className="input mt-1 min-h-[70px]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {hasEmail && (
          <button type="button" onClick={onApprove} disabled={pending} className="btn-primary">
            <Check className="h-4 w-4" /> Approve &amp; send invite
          </button>
        )}
        <button type="button" onClick={onApproveNoInvite} disabled={pending} className={hasEmail ? "btn-secondary" : "btn-primary"}>
          <Check className="h-4 w-4" /> Approve (no invite)
        </button>
        <button type="button" onClick={onReject} disabled={pending} className="btn-danger">
          <X className="h-4 w-4" /> Reject
        </button>
      </div>
      <p className="text-[11px] text-ink-faint">
        {hasEmail
          ? "“Send invite” emails the vendor a single-use link to set up their portal login. “No invite” just activates them — pick this if they won’t use the portal."
          : "No email on file, so a portal invite can’t be sent. Add an email on the vendor form first if you want to invite them."}
      </p>

      {generatedInvite && (
        <div className="rounded border border-brand-yellow-light bg-brand-yellow-50 p-3 text-xs">
          <div className="font-bold mb-1">Invite link (single-use, 7 days)</div>
          <div className="break-all font-mono text-[11px]">{generatedInvite}</div>
          <button
            type="button"
            onClick={copyInvite}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-yellow-dark hover:underline"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
      )}
    </div>
  );
}
