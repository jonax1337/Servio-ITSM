import { db } from "@/lib/db";
import { headers } from "next/headers";
import type { EmailNotice } from "@/lib/notification-email-rules";

/**
 * Best-effort client IP from the request headers. Returns null outside a request
 * scope (the scheduler / sync sweeps run with no request), so it never throws.
 */
async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return (fwd ? fwd.split(",")[0]?.trim() : null) || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

export async function writeAudit(input: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string | number;
  summary?: string;
  meta?: Record<string, unknown>;
  /** Explicit IP; when omitted it's captured from the request headers if available. */
  ip?: string | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: String(input.entityId),
        summary: input.summary,
        meta: JSON.stringify(input.meta ?? {}),
        ip: input.ip ?? (await requestIp()),
      },
    });
  } catch {
    // audit failures should never break the main action
  }
}

export type NotificationContent = {
  type?: string;
  title: string;
  body?: string;
  entity?: string;
  entityId?: string;
  /** Also email it, when the recipient has this notice's category switched on (lib/notification-mail.ts). */
  email?: EmailNotice;
};

/** Notify every active admin. */
export async function notifyAdmins(n: NotificationContent) {
  const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  await Promise.all(admins.map((admin) => notify(admin.id, n)));
}

export async function notify(userId: string, n: NotificationContent) {
  try {
    await db.notification.create({
      data: {
        userId,
        type: n.type ?? "INFO",
        title: n.title,
        body: n.body,
        entity: n.entity,
        entityId: n.entityId,
      },
    });
  } catch {
    /* noop */
  }
  if (!n.email) return;
  try {
    // Loaded on demand: most notify() callers never send mail, and the mail stack is heavy.
    const { deliverNotificationEmail } = await import("@/lib/notification-mail");
    await deliverNotificationEmail(userId, { email: n.email, entity: n.entity, entityId: n.entityId });
  } catch (error) {
    // A mail failure must never break the action that notified.
    console.error("[servio:notify] email copy failed:", error instanceof Error ? error.message : error);
  }
}
