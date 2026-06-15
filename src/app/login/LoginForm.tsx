"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signInAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await signInAction(fd);
          if (result?.error) {
            setError(result.error);
            return;
          }
          // Let the home page redirect based on role.
          router.push(next || "/");
          router.refresh();
        });
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input id="username" name="username" type="text" autoComplete="username" required className="input mt-1" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input mt-1" />
      </div>
      {error ? <div className="text-xs text-red-700">{error}</div> : null}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
