import { beforeEach, describe, expect, it, vi } from "vitest";

// Three priority-bound SLA tiers, as seeded: Gold (CRITICAL), Silver (HIGH), Bronze (MEDIUM).
const SLAS = [
  { id: "gold", priority: "CRITICAL", responseMins: 15, resolveMins: 240, isActive: true, businessCalendarId: null },
  { id: "silver", priority: "HIGH", responseMins: 60, resolveMins: 480, isActive: true, businessCalendarId: null },
  { id: "bronze", priority: "MEDIUM", responseMins: 240, resolveMins: 1440, isActive: true, businessCalendarId: null },
  { id: "vendor", priority: null, responseMins: 30, resolveMins: 120, isActive: true, businessCalendarId: null },
];

vi.mock("@/lib/db", () => ({
  db: {
    sLA: {
      findUnique: async ({ where }: { where: { id: string } }) => SLAS.find((s) => s.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { priority: string } }) => SLAS.find((s) => s.priority === where.priority) ?? null,
    },
    service: { findUnique: async () => null },
    businessCalendar: { findUnique: async () => null },
  },
}));

const { slaRepricePatch } = await import("@/lib/sla");

const created = new Date("2026-11-05T08:00:00Z");
const minutes = (n: number) => new Date(created.getTime() + n * 60_000);
const openTicket = { status: "IN_PROGRESS", createdAt: created, pausedMs: 0, firstResponseAt: null };

describe("slaRepricePatch", () => {
  beforeEach(() => vi.useRealTimers());

  it("measures new deadlines from the ticket's creation, not from now", async () => {
    vi.useFakeTimers({ now: minutes(180) });
    const patch = await slaRepricePatch(openTicket, { priority: "CRITICAL", serviceId: null, slaId: "bronze" });
    expect(patch).toMatchObject({ slaId: "gold", responseDueAt: minutes(15), resolveDueAt: minutes(240), dueAt: minutes(240) });
  });

  it("switches away from a priority-bound SLA the ticket no longer matches", async () => {
    const patch = await slaRepricePatch(openTicket, { priority: "HIGH", serviceId: null, slaId: "bronze" });
    expect(patch.slaId).toBe("silver");
  });

  it("keeps an explicitly chosen priority-agnostic SLA", async () => {
    const patch = await slaRepricePatch(openTicket, { priority: "CRITICAL", serviceId: null, slaId: "vendor" });
    expect(patch).toMatchObject({ slaId: "vendor", resolveDueAt: minutes(120) });
  });

  it("extends the deadlines by pause time the ticket already banked", async () => {
    const patch = await slaRepricePatch({ ...openTicket, pausedMs: 30 * 60_000 }, { priority: "CRITICAL", serviceId: null, slaId: null });
    expect(patch).toMatchObject({ responseDueAt: minutes(45), resolveDueAt: minutes(270) });
  });

  it("leaves the response deadline alone once the first response is recorded", async () => {
    const patch = await slaRepricePatch({ ...openTicket, firstResponseAt: minutes(10) }, { priority: "CRITICAL", serviceId: null, slaId: null });
    expect(patch).not.toHaveProperty("responseDueAt");
    expect(patch.resolveDueAt).toEqual(minutes(240));
  });

  it("does not touch a finished ticket", async () => {
    for (const status of ["RESOLVED", "CLOSED", "CANCELLED"]) {
      expect(await slaRepricePatch({ ...openTicket, status }, { priority: "CRITICAL", serviceId: null, slaId: null })).toEqual({});
    }
  });

  it("clears the deadlines only on an explicit SLA removal with no fallback", async () => {
    const target = { priority: "LOW", serviceId: null, slaId: null };
    expect(await slaRepricePatch(openTicket, target)).toEqual({});
    expect(await slaRepricePatch(openTicket, target, { slaCleared: true })).toEqual({ responseDueAt: null, resolveDueAt: null, dueAt: null });
  });

  it("applies an SLA the agent just picked even when it is bound to another priority", async () => {
    const patch = await slaRepricePatch(openTicket, { priority: "MEDIUM", serviceId: null, slaId: "gold" }, { slaChosen: true });
    expect(patch).toMatchObject({ slaId: "gold", resolveDueAt: minutes(240) });
  });
});
