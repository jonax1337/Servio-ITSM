import { describe, expect, it, vi } from "vitest";
import {
  buildBulkChanges, bulkOutcomeDetail, bulkSkipDetail, bulkSummary, planBulkTicket, withApplyResult,
  type BulkChange, type BulkOutcome, type BulkRules, type BulkTicketState,
} from "@/lib/bulk-edit";
import { mayActOnTicket } from "@/lib/authz";
import { ASSIGNEE_NOT_IN_GROUP, AWAITING_APPROVAL, NOT_YOUR_TICKET, TRANSITION_NOT_ALLOWED } from "@/lib/ticket-refusals";

// The pure access rule lives in lib/authz, whose imports reach the session and the database.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

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
  const entry = (ticket: string) => ({ ticket, reason: "x" });
  const outcome = (updated: number, partial: string[], skipped: string[]): BulkOutcome => ({
    updated, partial: partial.map(entry), skipped: skipped.map(entry),
  });

  it("reports a complete bulk edit", () => {
    expect(bulkSummary(outcome(5, [], []))).toBe("5 tickets updated");
  });

  it("uses the singular for one ticket", () => {
    expect(bulkSummary(outcome(1, [], []))).toBe("1 ticket updated");
  });

  it("counts the tickets that were skipped", () => {
    expect(bulkSummary(outcome(3, [], ["T-1", "T-2"]))).toBe("3 tickets updated, 2 skipped");
    expect(bulkSummary(outcome(0, [], ["T-1", "T-2"]))).toBe("2 tickets skipped");
  });

  it("counts partially updated tickets apart from skipped ones", () => {
    expect(bulkSummary(outcome(3, ["T-3"], ["T-1", "T-2"]))).toBe("3 tickets updated, 1 partially updated, 2 skipped");
    expect(bulkSummary(outcome(0, ["T-3"], []))).toBe("1 ticket partially updated");
    expect(bulkSummary(outcome(0, ["T-3", "T-4"], ["T-1"]))).toBe("2 tickets partially updated, 1 skipped");
  });
});

describe("withApplyResult", () => {
  const empty: BulkOutcome = { updated: 0, partial: [], skipped: [] };

  it("counts a ticket whose changes all applied as updated", () => {
    expect(withApplyResult(empty, "T-1", { applied: 2, refusal: null })).toEqual({ updated: 1, partial: [], skipped: [] });
  });

  it("skips a ticket that was refused before anything was written", () => {
    expect(withApplyResult(empty, "T-1", { applied: 0, refusal: "Not yours" }))
      .toEqual({ updated: 0, partial: [], skipped: [{ ticket: "T-1", reason: "Not yours" }] });
  });

  it("reports a ticket refused after an earlier change was written as partially updated, not skipped", () => {
    expect(withApplyResult(empty, "T-1", { applied: 1, refusal: "Assignee not in group" }))
      .toEqual({ updated: 0, partial: [{ ticket: "T-1", reason: "Assignee not in group" }], skipped: [] });
  });

  it("does not change the outcome it was given", () => {
    withApplyResult(empty, "T-1", { applied: 1, refusal: "x" });
    expect(empty).toEqual({ updated: 0, partial: [], skipped: [] });
  });
});

describe("bulkOutcomeDetail", () => {
  it("lists the partly updated tickets before the skipped ones", () => {
    expect(bulkOutcomeDetail({
      updated: 1,
      partial: [{ ticket: "T-3", reason: "Assignee not in group" }],
      skipped: [{ ticket: "T-1", reason: "Not yours" }],
    })).toBe("Partly updated: Assignee not in group (T-3). Skipped: Not yours (T-1)");
  });

  it("names only the groups that have tickets", () => {
    expect(bulkOutcomeDetail({ updated: 0, partial: [], skipped: [{ ticket: "T-1", reason: "Not yours" }] }))
      .toBe("Skipped: Not yours (T-1)");
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
    canAct: (state) => mayActOnTicket(user, state, isMember),
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

  it.each(["MANAGER", "ADMIN"])("lets a %s move tickets between groups and change the fields after", (role) => {
    const changes = patch({ field: "groupId", value: "network" }, { field: "priority", value: "HIGH" });
    expect(planBulkTicket(ticket, changes, rulesFor({ id: "mia", role }))).toBeNull();
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
