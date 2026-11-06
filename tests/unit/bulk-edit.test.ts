import { describe, expect, it } from "vitest";
import {
  buildBulkChanges, bulkSkipDetail, bulkSummary, planBulkTicket,
  type BulkChange, type BulkRules, type BulkTicketState,
} from "@/lib/bulk-edit";
import { ASSIGNEE_NOT_IN_GROUP, AWAITING_APPROVAL, NOT_YOUR_TICKET, TRANSITION_NOT_ALLOWED } from "@/lib/ticket-refusals";

describe("buildBulkChanges", () => {
  it("returns nothing when no field is set", () => {
    expect(buildBulkChanges({})).toEqual([]);
    expect(buildBulkChanges({ status: "", priority: "" })).toEqual([]);
  });

  it("applies the group before the assignee, whatever order the form posted", () => {
    expect(buildBulkChanges({ assigneeId: "u1", groupId: "g1" })).toEqual([
      { field: "groupId", value: "g1" },
      { field: "assigneeId", value: "u1" },
    ]);
  });

  it("collects every field of a combined edit in application order", () => {
    expect(buildBulkChanges({ status: "IN_PROGRESS", priority: "HIGH", categoryId: "c1", assigneeId: "u1", groupId: "g1" }))
      .toEqual([
        { field: "groupId", value: "g1" },
        { field: "assigneeId", value: "u1" },
        { field: "categoryId", value: "c1" },
        { field: "priority", value: "HIGH" },
        { field: "status", value: "IN_PROGRESS" },
      ]);
  });

  it("lets group, assignee and category be cleared with 'none'", () => {
    expect(buildBulkChanges({ groupId: "none", assigneeId: "none", categoryId: "none" })).toEqual([
      { field: "groupId", value: "none" },
      { field: "assigneeId", value: "none" },
      { field: "categoryId", value: "none" },
    ]);
  });

  it("does not let priority or status be cleared", () => {
    expect(buildBulkChanges({ priority: "none", status: "none" })).toEqual([]);
  });

  it("drops statuses that need a reason or note", () => {
    expect(buildBulkChanges({ status: "PENDING" })).toEqual([]);
    expect(buildBulkChanges({ status: "ON_HOLD" })).toEqual([]);
    expect(buildBulkChanges({ status: "CANCELLED" })).toEqual([]);
  });

  it("drops off-list priorities and unknown fields", () => {
    expect(buildBulkChanges({ priority: "URGENT-ISH", requesterId: "u9", title: "x" })).toEqual([]);
  });

  it("ignores a patch that is not an object", () => {
    expect(buildBulkChanges(null)).toEqual([]);
    expect(buildBulkChanges("status=OPEN")).toEqual([]);
  });
});

describe("bulkSummary", () => {
  const skip = (ticket: string) => ({ ticket, reason: "x" });

  it("reports a complete bulk edit", () => {
    expect(bulkSummary({ updated: 5, skipped: [] })).toBe("5 tickets updated");
  });

  it("uses the singular for one ticket", () => {
    expect(bulkSummary({ updated: 1, skipped: [] })).toBe("1 ticket updated");
  });

  it("counts the tickets that were skipped", () => {
    expect(bulkSummary({ updated: 3, skipped: [skip("T-1"), skip("T-2")] })).toBe("3 tickets updated, 2 skipped");
    expect(bulkSummary({ updated: 0, skipped: [skip("T-1"), skip("T-2")] })).toBe("2 tickets skipped");
  });
});

describe("bulkSkipDetail", () => {
  it("groups tickets by the reason they were skipped", () => {
    expect(bulkSkipDetail([
      { ticket: "T-1", reason: "Not yours" },
      { ticket: "T-2", reason: "Blocked" },
      { ticket: "T-3", reason: "Not yours" },
    ])).toBe("Not yours (T-1, T-3); Blocked (T-2)");
  });

  it("names the first few tickets and counts the rest", () => {
    const skipped = ["T-1", "T-2", "T-3", "T-4", "T-5"].map((ticket) => ({ ticket, reason: "Not yours" }));
    expect(bulkSkipDetail(skipped)).toBe("Not yours (T-1, T-2, T-3 and 2 more)");
  });

  it("shows the first reasons and counts the others", () => {
    const skipped = ["a", "b", "c", "d", "e"].map((reason, i) => ({ ticket: `T-${i}`, reason }));
    expect(bulkSkipDetail(skipped)).toBe("a (T-0); b (T-1); c (T-2); and 2 more reasons");
  });
});

describe("planBulkTicket", () => {
  const agent = { id: "ana", role: "AGENT" };
  const groups: Record<string, string[]> = { desk: ["ana", "sam"], network: ["lee"] };
  const isMember = (groupId: string, userId: string) => groups[groupId]?.includes(userId) ?? false;
  const rulesFor = (user: { id: string; role: string }, blockedStatus?: string): BulkRules => ({
    // The access rule in short: managers act anywhere, agents on their own tickets and their groups' tickets.
    canAct: (state) =>
      user.role === "MANAGER" || state.assigneeId === user.id || (state.groupId ? isMember(state.groupId, user.id) : true),
    isMember,
    statusRefusal: (state, to) => {
      if (state.approvalState === "PENDING" && to !== "CANCELLED") return AWAITING_APPROVAL;
      return to === blockedStatus ? TRANSITION_NOT_ALLOWED : null;
    },
  });
  const ticket: BulkTicketState = { status: "OPEN", groupId: "desk", assigneeId: "sam", approvalState: null, mergedIntoId: null };
  const patch = (...changes: BulkChange[]) => changes;

  it("accepts a ticket every field of which applies", () => {
    const changes = patch({ field: "priority", value: "HIGH" }, { field: "status", value: "IN_PROGRESS" });
    expect(planBulkTicket(ticket, changes, rulesFor(agent))).toBeNull();
  });

  it("refuses a ticket the actor may not change, before anything is written", () => {
    const stranger = { id: "lee", role: "AGENT" };
    expect(planBulkTicket(ticket, patch({ field: "priority", value: "HIGH" }), rulesFor(stranger))).toBe(NOT_YOUR_TICKET);
  });

  it("refuses the whole patch when a later field would be refused after a group move", () => {
    const changes = patch({ field: "groupId", value: "network" }, { field: "priority", value: "HIGH" });
    expect(planBulkTicket({ ...ticket, assigneeId: null }, changes, rulesFor(agent))).toBe(NOT_YOUR_TICKET);
  });

  it("lets a manager move tickets between groups and change the fields after", () => {
    const changes = patch({ field: "groupId", value: "network" }, { field: "priority", value: "HIGH" });
    expect(planBulkTicket(ticket, changes, rulesFor({ id: "mia", role: "MANAGER" }))).toBeNull();
  });

  it("refuses an assignee who is not in the ticket's group", () => {
    expect(planBulkTicket(ticket, patch({ field: "assigneeId", value: "lee" }), rulesFor(agent))).toBe(ASSIGNEE_NOT_IN_GROUP);
  });

  it("checks the assignee against the group the same patch moves the ticket to", () => {
    const manager = rulesFor({ id: "mia", role: "MANAGER" });
    expect(planBulkTicket(ticket, patch({ field: "groupId", value: "network" }, { field: "assigneeId", value: "lee" }), manager)).toBeNull();
    expect(planBulkTicket(ticket, patch({ field: "groupId", value: "network" }, { field: "assigneeId", value: "ana" }), manager)).toBe(ASSIGNEE_NOT_IN_GROUP);
  });

  it("clears a former assignee who does not belong to the new group before checking access", () => {
    const changes = patch({ field: "groupId", value: "network" }, { field: "categoryId", value: "hw" });
    // ana (assignee) is not in "network": the group move drops her assignment, so she can't touch the ticket afterwards.
    expect(planBulkTicket({ ...ticket, assigneeId: "ana" }, changes, rulesFor(agent))).toBe(NOT_YOUR_TICKET);
  });

  it("accepts removing the assignee and the group", () => {
    const changes = patch({ field: "groupId", value: "none" }, { field: "assigneeId", value: "none" });
    expect(planBulkTicket(ticket, changes, rulesFor(agent))).toBeNull();
  });

  it("refuses a status the workflow does not allow", () => {
    expect(planBulkTicket(ticket, patch({ field: "status", value: "CLOSED" }), rulesFor(agent, "CLOSED"))).toBe(TRANSITION_NOT_ALLOWED);
  });

  it("refuses a status change on a request awaiting approval", () => {
    const awaiting = { ...ticket, approvalState: "PENDING" };
    expect(planBulkTicket(awaiting, patch({ field: "status", value: "IN_PROGRESS" }), rulesFor(agent))).toBe(AWAITING_APPROVAL);
  });
});
