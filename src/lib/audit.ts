import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/rbac";

type Action = "CREATE" | "UPDATE" | "DELETE";

/**
 * Logs a state-changing operation. Call from server actions AFTER the write succeeds.
 * Never blocks the parent flow — fire-and-forget with a console.error fallback.
 */
export async function logWrite(
  entity: string,
  entityId: string,
  action: Action,
  before?: unknown,
  after?: unknown,
) {
  try {
    const user = await getCurrentUser();
    await prisma.auditLog.create({
      data: {
        entity,
        entityId,
        action,
        userId: user?.id ?? null,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
      },
    });
  } catch (e) {
    console.error("[audit] logWrite failed:", e);
  }
}
