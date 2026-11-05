import { describe, expect, it } from "vitest";
import { customerReplyReopenData } from "@/lib/sla";

const now = new Date("2026-11-05T10:00:00Z");
const clock = { responseDueAt: null, resolveDueAt: null, dueAt: null, pendingSince: null, pausedMs: 0 };

// A requester replying on a finished ticket (portal or email) must put it back in
// the agent's queue — otherwise the reply sits unseen on a RESOLVED/CLOSED ticket.
describe("customerReplyReopenData", () => {
  it.each(["RESOLVED", "CLOSED"])("reopens a %s ticket and clears its resolution stamps", (status) => {
    const patch = customerReplyReopenData(
      { ...clock, status, resolutionCode: "FIXED", resolutionNote: "done" },
      now,
    );
    expect(patch).toMatchObject({
      status: "OPEN",
      resolvedAt: null,
      closedAt: null,
      resolutionCode: null,
      resolutionNote: null,
      resolveBreached: false,
      pendingReason: null,
      pendingNote: null,
    });
  });

  it("hands a ticket awaiting the customer back to the agent and resumes the SLA clock", () => {
    const pendingSince = new Date("2026-11-05T09:00:00Z");
    const resolveDueAt = new Date("2026-11-06T09:00:00Z");
    const patch = customerReplyReopenData(
      { ...clock, resolveDueAt, pendingSince, status: "PENDING", pendingReason: "AWAITING_CUSTOMER" },
      now,
    );
    expect(patch).toMatchObject({
      status: "OPEN",
      pendingSince: null,
      pausedMs: 60 * 60_000,
      resolveDueAt: new Date("2026-11-06T10:00:00Z"),
      pendingReason: null,
    });
  });

  it("keeps a ticket parked on a vendor or change when the customer writes", () => {
    for (const pendingReason of ["AWAITING_VENDOR", "AWAITING_CHANGE", "AWAITING_PARTS", "SCHEDULED"]) {
      expect(customerReplyReopenData({ ...clock, status: "PENDING", pendingReason }, now), pendingReason).toBeNull();
    }
  });

  it.each(["NEW", "OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD", "CANCELLED"])("leaves a %s ticket's status alone", (status) => {
    expect(customerReplyReopenData({ ...clock, status }, now)).toBeNull();
  });
});
