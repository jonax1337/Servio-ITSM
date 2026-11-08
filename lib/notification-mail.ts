import "server-only";

import { db } from "@/lib/db";
import { mailBrand, sendMail } from "@/lib/mail";
import { renderNotificationEmail } from "@/lib/email-templates";
import { ticketRef } from "@/lib/constants";
import {
  emailNotificationCategory,
  parseEmailNotificationPrefs,
  type EmailNotice,
  type NoticeTicket,
} from "@/lib/notification-email-rules";

/** Console pages the notification email links to, by notification entity. */
const ENTITY_PATH: Record<string, (id: string) => string> = {
  Ticket: (id) => `/tickets/${id}`,
  Contract: (id) => `/contracts/${id}`,
  SoftwareLicense: (id) => `/contracts/licenses/${id}`,
  RecurringTicket: () => "/settings/recurring-tickets",
};

/**
 * Email copy of an in-app notification, sent when the recipient has the notice's
 * category switched on (Account settings › Notifications; defaults in
 * lib/notification-email-rules.ts). Uses the "notification" template in the
 * recipient's language. Internal mail: never threaded onto the ticket, so it cannot
 * leak into the requester's conversation. Called by notify() in lib/audit.ts.
 */
export async function deliverNotificationEmail(
  userId: string,
  n: { email: EmailNotice; entity?: string; entityId?: string },
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, locale: true, isActive: true, emailNotifications: true },
  });
  if (!user?.isActive || !user.email) return;
  if (!parseEmailNotificationPrefs(user.emailNotifications)[emailNotificationCategory(n.email)]) return;

  let ticket: NoticeTicket | undefined;
  if (n.entity === "Ticket" && n.entityId) {
    const row = await db.ticket.findUnique({
      where: { id: Number(n.entityId) },
      select: { id: true, title: true, type: true, prefix: true },
    });
    if (row) ticket = { ref: ticketRef(row.id, row.prefix || row.type), title: row.title };
  }

  const brand = await mailBrand(user);
  const path = n.entity && n.entityId ? ENTITY_PATH[n.entity]?.(n.entityId) : undefined;
  const url = brand.appUrl && path ? `${brand.appUrl.replace(/\/+$/, "")}${path}` : null;
  await sendMail({
    to: user.email,
    toName: user.name,
    entity: n.entity ?? "Notification",
    entityId: n.entityId,
    ...(await renderNotificationEmail({ brand, recipientName: user.name ?? "", notice: n.email, ticket, url })),
  });
}
