import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/rbac";
import { parseFlexibleDate, toDisplayDate, addDays } from "@/lib/date";
import { AuditFilters } from "./AuditFilters";
import { ScrollText } from "lucide-react";

const ACTION_STYLES: Record<string, string> = {
  CREATE: "border-green-300 bg-green-50 text-green-800",
  UPDATE: "border-sky-300 bg-sky-50 text-sky-800",
  DELETE: "border-red-300 bg-red-50 text-red-700",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string; userId?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const where: Record<string, unknown> = {};
  if (sp.entity) where.entity = sp.entity;
  if (sp.action) where.action = sp.action;
  if (sp.userId) where.userId = sp.userId;
  if (sp.from || sp.to) {
    const d: { gte?: Date; lt?: Date } = {};
    if (sp.from) { const f = parseFlexibleDate(sp.from); if (f) d.gte = f; }
    // Use `lt` next-day so the selected "to" date is INCLUDED (not cut off at midnight).
    if (sp.to) { const t = parseFlexibleDate(sp.to); if (t) d.lt = addDays(t, 1); }
    where.at = d;
  }

  const [logs, users, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      take: 500,
    }),
    prisma.user.findMany({ select: { id: true, username: true } }),
    prisma.auditLog.findMany({ select: { entity: true }, distinct: ["entity"] }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u.username]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">Audit Log</h1>
        <p className="text-sm text-ink-faint">Read-only trail of state changes · last 500 entries</p>
      </div>

      <AuditFilters
        entities={entities.map((e) => e.entity).sort()}
        users={users}
        initial={{
          entity: sp.entity ?? "",
          action: sp.action ?? "",
          userId: sp.userId ?? "",
          from: sp.from ?? "",
          to: sp.to ?? "",
        }}
      />

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th w-44">When</th>
              <th className="th">Actor</th>
              <th className="th">Action</th>
              <th className="th">Entity</th>
              <th className="th">Entity ID</th>
              <th className="th">Changes</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="td">
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-ink-faint">
                    <ScrollText className="h-10 w-10 opacity-40" />
                    <div className="text-sm">No audit entries match your filters.</div>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id} className="hover:bg-brand-yellow-50/40 align-top">
                  <td className="td whitespace-nowrap text-xs">
                    {toDisplayDate(l.at)}{" "}
                    <span className="text-ink-faint">{l.at.toISOString().slice(11, 19)}</span>
                  </td>
                  <td className="td">{l.userId ? userById.get(l.userId) ?? l.userId.slice(0, 8) : "—"}</td>
                  <td className="td">
                    <span className={`badge ${ACTION_STYLES[l.action] ?? "border-border bg-surface-gray-100 text-ink-mid"}`}>{l.action}</span>
                  </td>
                  <td className="td font-mono text-xs">{l.entity}</td>
                  <td className="td font-mono text-[11px]">{l.entityId.slice(0, 12)}{l.entityId.length > 12 ? "…" : ""}</td>
                  <td className="td max-w-md">
                    {l.before || l.after ? (
                      <details className="cursor-pointer">
                        <summary className="text-xs text-ink-faint">expand</summary>
                        <pre className="mt-2 text-[11px] bg-surface-gray-100 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">
{l.before ? `BEFORE:\n${l.before}\n\n` : ""}{l.after ? `AFTER:\n${l.after}` : ""}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
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
