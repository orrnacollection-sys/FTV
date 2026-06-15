"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptInvite } from "./actions";
import { toast } from "@/components/Toast";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    startTransition(async () => {
      const res = await acceptInvite(token, fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Account created — sign in to continue");
      router.push("/login");
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label">Choose a username</label>
        <input name="username" required autoComplete="username" className="input mt-1" placeholder="e.g. priya" />
        {errors.username && <div className="mt-1 text-[11px] text-red-700">{errors.username}</div>}
      </div>
      <div>
        <label className="label">Password</label>
        <input name="password" type="password" required autoComplete="new-password" className="input mt-1" />
        <div className="mt-1 text-[11px] text-ink-faint">10+ chars · uppercase · lowercase · digit</div>
        {errors.password && <div className="mt-1 text-[11px] text-red-700">{errors.password}</div>}
      </div>
      <div>
        <label className="label">Confirm password</label>
        <input name="confirm" type="password" required autoComplete="new-password" className="input mt-1" />
        {errors.confirm && <div className="mt-1 text-[11px] text-red-700">{errors.confirm}</div>}
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Creating account…" : "Activate account"}
      </button>
    </form>
  );
}
