/**
 * Which in-app notifications are also sent by email, per person (Account settings ›
 * Notifications, stored as JSON in User.emailNotifications; null = the defaults), and
 * the English wording of those emails. German wording: messages/emails/de.ts.
 * The delivery itself lives in lib/notification-mail.ts.
 */

export const EMAIL_NOTIFICATION_CATEGORIES = [
  "NEW_UNASSIGNED",
  "REQUESTER_REPLY",
  "SLA",
  "CONTRACTS",
  "RECURRING",
] as const;
export type EmailNotificationCategory = (typeof EMAIL_NOTIFICATION_CATEGORIES)[number];
export type EmailNotificationPrefs = Record<EmailNotificationCategory, boolean>;

/**
 * Defaults for someone who never changed the setting: what concerns their own work is
 * on; a copy of every new unassigned ticket in their groups is off (noisy in big teams).
 */
export const DEFAULT_EMAIL_NOTIFICATIONS: EmailNotificationPrefs = {
  NEW_UNASSIGNED: false,
  REQUESTER_REPLY: true,
  SLA: true,
  CONTRACTS: true,
  RECURRING: true,
};

/** The stored JSON as a complete preference set; unknown keys and non-booleans fall back to the default. */
export function parseEmailNotificationPrefs(json: string | null | undefined): EmailNotificationPrefs {
  const prefs = { ...DEFAULT_EMAIL_NOTIFICATIONS };
  if (!json) return prefs;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return prefs;
    for (const category of EMAIL_NOTIFICATION_CATEGORIES) {
      if (typeof raw[category] === "boolean") prefs[category] = raw[category];
    }
  } catch {
    // unreadable value: the defaults apply
  }
  return prefs;
}

/** The preference set from the account form: a category is on when its switch was submitted as "on". */
export function emailNotificationPrefsFromForm(get: (name: string) => unknown): EmailNotificationPrefs {
  return Object.fromEntries(
    EMAIL_NOTIFICATION_CATEGORIES.map((category) => [category, get(`emailNotify.${category}`) === "on"]),
  ) as EmailNotificationPrefs;
}

/** What a notification email is about; the delivery adds the ticket (ref, title) for ticket notices. */
export type EmailNotice =
  | { kind: "TICKET_UNASSIGNED"; groupName: string }
  | { kind: "REQUESTER_REPLY"; authorName: string; snippet: string }
  | { kind: "SLA_ESCALATION"; percent: number }
  | { kind: "SLA_NUDGE"; percent: number }
  | { kind: "CONTRACT_RENEWAL"; name: string; endDate: Date; autoRenew: boolean }
  | { kind: "LICENSE_OVER_ALLOCATED"; name: string; used: number; seats: number }
  | { kind: "RECURRING_FAILED"; name: string; error: string };

const CATEGORY_OF: Record<EmailNotice["kind"], EmailNotificationCategory> = {
  TICKET_UNASSIGNED: "NEW_UNASSIGNED",
  REQUESTER_REPLY: "REQUESTER_REPLY",
  SLA_ESCALATION: "SLA",
  SLA_NUDGE: "SLA",
  CONTRACT_RENEWAL: "CONTRACTS",
  LICENSE_OVER_ALLOCATED: "CONTRACTS",
  RECURRING_FAILED: "RECURRING",
};

export function emailNotificationCategory(notice: EmailNotice): EmailNotificationCategory {
  return CATEGORY_OF[notice.kind];
}

/** The ticket a ticket notice is about (empty for contract, license and schedule notices). */
export type NoticeTicket = { ref?: string; title?: string };

/** Subject, lead sentence and an optional quoted block (reply text, error) of a notification email. */
export type NoticeText = { subject: string; message: string; details?: string };

export type NoticeTextFn = (notice: EmailNotice, ticket: NoticeTicket, formatDate: (d: Date) => string) => NoticeText;

/** English wording of the notification emails. */
export const noticeTextEn: NoticeTextFn = (notice, { ref = "", title = "" }, formatDate) => {
  switch (notice.kind) {
    case "TICKET_UNASSIGNED":
      return {
        subject: `[${ref}] New unassigned ticket in ${notice.groupName}: ${title}`,
        message: `Ticket ${ref} — “${title}” — is in ${notice.groupName} and nobody is assigned to it yet.`,
      };
    case "REQUESTER_REPLY":
      return {
        subject: `[${ref}] ${notice.authorName} replied: ${title}`,
        message: `${notice.authorName} replied to ticket ${ref} — “${title}”:`,
        details: notice.snippet,
      };
    case "SLA_ESCALATION":
      return {
        subject: `[${ref}] SLA escalation: ${notice.percent}% elapsed`,
        message: `Ticket ${ref} — “${title}” — has used ${notice.percent}% of its SLA.`,
      };
    case "SLA_NUDGE":
      return notice.percent >= 100
        ? { subject: `[${ref}] Past its SLA: ${title}`, message: `The resolve deadline of your ticket ${ref} — “${title}” — has passed.` }
        : {
            subject: `[${ref}] Running out of SLA time: ${title}`,
            message: `Your ticket ${ref} — “${title}” — has used ${notice.percent}% of its resolve time.`,
          };
    case "CONTRACT_RENEWAL":
      return {
        subject: `Contract “${notice.name}” ends on ${formatDate(notice.endDate)}`,
        message: `The contract “${notice.name}” you own ends on ${formatDate(notice.endDate)}. ${
          notice.autoRenew ? "It renews automatically unless you cancel it in time." : "It will lapse unless you renew it."
        }`,
      };
    case "LICENSE_OVER_ALLOCATED":
      return {
        subject: `License “${notice.name}” is over-allocated`,
        message: `The license “${notice.name}” you own has ${notice.used} seats assigned but only ${notice.seats} purchased.`,
      };
    case "RECURRING_FAILED":
      return {
        subject: `Recurring ticket “${notice.name}” could not create its ticket`,
        message: `The recurring ticket “${notice.name}” you created could not create its ticket:`,
        details: notice.error,
      };
  }
};
