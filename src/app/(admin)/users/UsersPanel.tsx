"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toDisplayDate } from "@/lib/date";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { createInvite, revokeInvite, setUserActive, setUserCanEdit } from "./actions";
import { toast } from "@/components/Toast";
import { Copy, X, UserPlus, Power, Pencil, PencilOff } from "lucide-react";

type User = {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  canEdit: boolean;
  vendorName: string | null;
  lastLoginAt: Date | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  vendorName: string | null;
  expiresAt: Date;
  token: string;
};

type VendorOpt = { id: string; code: string | null; name: string };

export function UsersPanel({
  users,
  invites,
  vendors,
}: {
  users: User[];
  invites: Invite[];
  vendors: VendorOpt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generated, setGenerated] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [role, setRole] = useState<Role>("VENDOR_ADMIN");
  const [vendorId, setVendorId] = useState("");

  const onInvite = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    setGenerated(null);
    startTransition(async () => {
      const res = await createInvite(fd);
      if ("error" in res) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setGenerated(res.inviteUrl ?? null);
      toast.success("Invite created");
      router.refresh();
    });
  };

  const onRevoke = (id: string, email: string) => {
    if (!window.confirm(`Revoke invite to ${email}?`)) return;
    startTransition(async () => {
      const res = await revokeInvite(id);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Invite revoked");
        router.refresh();
      }
    });
  };

  const onToggle = (u: User) => {
    startTransition(async () => {
      const res = await setUserActive(u.id, !u.isActive);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(u.isActive ? "User deactivated" : "User activated");
        router.refresh();
      }
    });
  };

  const onToggleEditor = (u: User) => {
    startTransition(async () => {
      const res = await setUserCanEdit(u.id, !u.canEdit);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(u.canEdit ? "Editor permission removed" : "Editor permission granted");
        router.refresh();
      }
    });
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="card overflow-hidden">
          <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">
            Active users · {users.length}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Username</th>
                  <th className="th">Email</th>
                  <th className="th">Role</th>
                  <th className="th">Editor</th>
                  <th className="th">Vendor</th>
                  <th className="th">Last login</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.isActive ? "" : "opacity-50"}>
                    <td className="td font-mono text-xs">{u.username}</td>
                    <td className="td">{u.email}</td>
                    <td className="td">
                      <span className="badge border-brand-yellow-light bg-brand-yellow-50">
                        {ROLE_LABELS[u.role as Role] ?? u.role}
                      </span>
                    </td>
                    <td className="td">
                      {u.role === "ADMIN" ? (
                        <button
                          type="button"
                          onClick={() => onToggleEditor(u)}
                          disabled={pending}
                          className={u.canEdit ? "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-blue-700 hover:bg-blue-50" : "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-faint hover:bg-brand-yellow-pale"}
                          title={u.canEdit ? "Can edit — click to revoke (view-only)" : "Grant editor permission (allow Edit / Delete / Save)"}
                        >
                          {u.canEdit ? <Pencil className="h-4 w-4" /> : <PencilOff className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="td">{u.vendorName ?? "—"}</td>
                    <td className="td">{u.lastLoginAt ? toDisplayDate(u.lastLoginAt) : "—"}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onToggle(u)}
                          disabled={pending}
                          className="rounded p-1.5 text-ink-mid hover:bg-brand-yellow-pale"
                          title={u.isActive ? "Deactivate" : "Activate"}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-border bg-brand-yellow-pale px-4 py-2 text-[10px] font-bold uppercase tracking-[.08em]">
            Pending invites · {invites.length}
          </div>
          {invites.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-faint">No pending invites.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Email</th>
                    <th className="th">Role</th>
                    <th className="th">Vendor</th>
                    <th className="th">Expires</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td className="td">{i.email}</td>
                      <td className="td">{ROLE_LABELS[i.role as Role] ?? i.role}</td>
                      <td className="td">{i.vendorName ?? "—"}</td>
                      <td className="td">{toDisplayDate(i.expiresAt)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => copy(`${window.location.origin}/invite/${i.token}`)}
                            className="rounded p-1.5 hover:bg-brand-yellow-pale"
                            title="Copy invite link"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRevoke(i.id, i.email)}
                            className="rounded p-1.5 text-red-700 hover:bg-red-50"
                            title="Revoke"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <form onSubmit={onInvite} className="card p-5 h-fit space-y-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-brand-yellow-dark" />
          <div className="text-[10px] font-bold uppercase tracking-[.1em]">Invite user</div>
        </div>

        <div>
          <label className="label">Email</label>
          <input name="email" type="email" required className="input mt-1" />
          {errors.email && <div className="mt-1 text-[11px] text-red-700">{errors.email}</div>}
        </div>

        <div>
          <label className="label">Role</label>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="input mt-1"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {role !== "ADMIN" && (
          <div>
            <label className="label">Vendor</label>
            <select
              name="vendorId"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              required
              className="input mt-1"
            >
              <option value="">— select vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.code ? `${v.code} · ` : ""}{v.name}</option>
              ))}
            </select>
            {errors.vendorId && <div className="mt-1 text-[11px] text-red-700">{errors.vendorId}</div>}
          </div>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Creating…" : "Create invite"}
        </button>

        {generated && (
          <div className="rounded border border-brand-yellow-light bg-brand-yellow-50 p-3 text-xs">
            <div className="font-bold mb-1">Invite link (single-use, 7 days)</div>
            <div className="break-all font-mono text-[11px]">{generated}</div>
            <button
              type="button"
              onClick={() => copy(generated)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-yellow-dark hover:underline"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
