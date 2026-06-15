"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Filters = { entity: string; action: string; userId: string; from: string; to: string };

export function AuditFilters({
  entities,
  users,
  initial,
}: {
  entities: string[];
  users: { id: string; username: string }[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    (["entity", "action", "userId", "from", "to"] as const).forEach((k) => {
      if (f[k]) url.searchParams.set(k, f[k]);
      else url.searchParams.delete(k);
    });
    router.push(url.pathname + url.search);
  };

  return (
    <form onSubmit={onApply} className="mb-4 card p-3 grid grid-cols-1 gap-2 md:grid-cols-6">
      <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} className="input">
        <option value="">All entities</option>
        {entities.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>
      <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} className="input">
        <option value="">All actions</option>
        <option value="CREATE">CREATE</option>
        <option value="UPDATE">UPDATE</option>
        <option value="DELETE">DELETE</option>
      </select>
      <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} className="input">
        <option value="">All actors</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
      <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="input" />
      <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="input" />
      <button type="submit" className="btn-primary">Apply</button>
    </form>
  );
}
