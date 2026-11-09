import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A service account never receives email: the one sending path (`sendMail`) drops it from every recipient
 * list, for every kind of message, and records a message nobody is left to receive as SUPPRESSED.
 */

const state = vi.hoisted(() => ({
  serviceAccounts: [] as { email: string; secondaryEmails: { email: string }[] }[],
  rows: [] as Record<string, unknown>[],
  sent: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: async () => state.serviceAccounts },
    emailMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${state.rows.length + 1}`, ...data };
        state.rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(state.rows.find((r) => r.id === where.id)!, data);
      },
    },
  },
}));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => ({ SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_FROM: "Servio <servio@example.test>" })[key] ?? null,
}));
vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: async (message: Record<string, unknown>) => { state.sent.push(message); } }),
}));

import { SUPPRESSED_REASON, SUPPRESSED_STATUS, sendMail } from "@/lib/mail";

const message = { subject: "Your ticket was resolved", body: "Done." };

beforeEach(() => {
  state.serviceAccounts = [{ email: "robot@example.test", secondaryEmails: [{ email: "robot-alias@example.test" }] }];
  state.rows = [];
  state.sent = [];
});

describe("sendMail and service accounts", () => {
  it("does not send to a service account and records why", async () => {
    await sendMail({ ...message, to: "robot@example.test", template: "ticket_resolved", ticketId: 5 });
    expect(state.sent).toHaveLength(0);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ status: SUPPRESSED_STATUS, error: SUPPRESSED_REASON, toEmail: "robot@example.test", ticketId: 5 });
  });

  it("matches the address whatever its case, and secondary addresses too", async () => {
    await sendMail({ ...message, to: "Robot@Example.TEST" });
    await sendMail({ ...message, to: "robot-alias@example.test" });
    expect(state.sent).toHaveLength(0);
    expect(state.rows.map((r) => r.status)).toEqual([SUPPRESSED_STATUS, SUPPRESSED_STATUS]);
  });

  it("sends to everybody else as before", async () => {
    await sendMail({ ...message, to: "jane@example.test", toName: "Jane" });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ to: "Jane <jane@example.test>" });
    expect(state.rows[0]).toMatchObject({ status: "SENT" });
  });

  it("removes a service account from cc and bcc but still sends to the rest", async () => {
    await sendMail({ ...message, to: "jane@example.test", cc: ["robot@example.test", "bob@example.test"], bcc: ["robot-alias@example.test"] });
    expect(state.sent[0]).toMatchObject({ to: "jane@example.test", cc: ["bob@example.test"], bcc: undefined });
  });

  it("hands the message to the person copied when the main recipient is a service account", async () => {
    await sendMail({ ...message, to: "robot@example.test", toName: "Robot", cc: ["bob@example.test"] });
    expect(state.sent).toHaveLength(1);
    // The name belonged to the service account, so it is not put in front of Bob's address.
    expect(state.sent[0]).toMatchObject({ to: "bob@example.test", cc: undefined });
  });

  it("is a no-op for the rule when there are no service accounts", async () => {
    state.serviceAccounts = [];
    await sendMail({ ...message, to: "robot@example.test" });
    expect(state.sent).toHaveLength(1);
  });
});
