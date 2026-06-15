"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { activateLicenseAction } from "./actions";

export function LicenseForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await activateLicenseAction(fd);
      if (!("ok" in r) || !r.ok) {
        const msg = "error" in r ? r.error : "Activation failed";
        setErr(msg);
        toast.error(msg);
        return;
      }
      toast.success("License activated");
      setKey("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="block text-xs font-bold uppercase tracking-wide text-ink-mid mb-1">
          License Key
        </span>
        <textarea
          name="key"
          className="input font-mono text-xs"
          rows={4}
          placeholder="FTV-eyJ2IjoxLCJwbGFuIjoiUFJPIiwic2VhdHMiOjUsLi4u.abc123def456..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
        />
        {err && <span className="block text-xs text-rose-600 mt-1">{err}</span>}
      </label>
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-faint">
          Keys are issued by Adwitiya ops. Re-activating the same key is a no-op; activating a new
          one demotes the previous license to REPLACED.
        </p>
        <button type="submit" className="btn-primary" disabled={busy || !key.trim()}>
          {busy ? "Verifying…" : "Activate"}
        </button>
      </div>
    </form>
  );
}
