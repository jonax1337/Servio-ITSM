import { describe, expect, it } from "vitest";
import {
  UNDO_WINDOW_MS, applyPropertyEdit, changesBetween, undoBlocker, undoChanges, withChanges, type PropertyValues,
} from "@/lib/ticket-property-edits";

const ticket: PropertyValues = {
  status: "IN_PROGRESS", type: "INCIDENT", priority: "MEDIUM", impact: "MEDIUM", urgency: "MEDIUM",
  assigneeId: "sam", groupId: "service-desk", categoryId: "none", serviceId: "none",
};
const members = { "service-desk": ["sam", "ana"], network: ["lee"] };

describe("undo window", () => {
  it("is a few seconds, long enough to notice a wrong pick and short enough not to linger", () => {
    expect(UNDO_WINDOW_MS).toBeGreaterThanOrEqual(5_000);
    expect(UNDO_WINDOW_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("applyPropertyEdit", () => {
  it("changes only the edited field", () => {
    expect(applyPropertyEdit(ticket, { field: "priority", value: "HIGH" }, members)).toEqual({ ...ticket, priority: "HIGH" });
  });

  it("clears the assignee when the new group does not include them", () => {
    expect(applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members)).toMatchObject({ groupId: "network", assigneeId: "none" });
  });

  it("keeps the assignee when they belong to the new group", () => {
    expect(applyPropertyEdit(ticket, { field: "groupId", value: "service-desk" }, members).assigneeId).toBe("sam");
  });

  it("keeps the assignee when the group is removed", () => {
    expect(applyPropertyEdit(ticket, { field: "groupId", value: "none" }, members).assigneeId).toBe("sam");
  });

  it("keeps an unassigned ticket unassigned when it moves to a group", () => {
    expect(applyPropertyEdit({ ...ticket, assigneeId: "none" }, { field: "groupId", value: "network" }, members).assigneeId).toBe("none");
  });

  it("does not mutate the values it was given", () => {
    applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members);
    expect(ticket.assigneeId).toBe("sam");
  });
});

describe("changesBetween", () => {
  it("is empty when nothing changed", () => {
    expect(changesBetween(ticket, ticket)).toEqual([]);
  });

  it("turns an edit back with the values it had before", () => {
    const after = applyPropertyEdit(ticket, { field: "priority", value: "HIGH" }, members);
    expect(changesBetween(after, ticket)).toEqual([{ field: "priority", value: "MEDIUM" }]);
  });

  it("restores the group before the assignee, so the assignee is checked against the old group", () => {
    const after = applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members);
    expect(changesBetween(after, ticket)).toEqual([
      { field: "groupId", value: "service-desk" },
      { field: "assigneeId", value: "sam" },
    ]);
  });

  it("round-trips: undoing an edit gives back the original values", () => {
    const after = applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members);
    expect(withChanges(after, changesBetween(after, ticket))).toEqual(ticket);
  });
});

describe("undoChanges", () => {
  it("expects every field to still hold what the edit left there", () => {
    const after = applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members);
    expect(undoChanges(ticket, after)).toEqual([
      { field: "groupId", value: "service-desk", expected: "network" },
      { field: "assigneeId", value: "sam", expected: "none" },
    ]);
  });
});

describe("undoBlocker", () => {
  const before = ticket;
  const after = applyPropertyEdit(ticket, { field: "priority", value: "HIGH" }, members);

  it("offers undo while the edited field still holds the edit's value", () => {
    expect(undoBlocker(after, before, after)).toBeNull();
  });

  it("blocks undo once someone else changed the edited field", () => {
    expect(undoBlocker({ ...after, priority: "CRITICAL" }, before, after)).toBe("changed");
  });

  it("ignores changes to fields the undo would not touch", () => {
    expect(undoBlocker({ ...after, categoryId: "hardware" }, before, after)).toBeNull();
  });

  it("blocks undoing a group move once the assignee was changed meanwhile", () => {
    const moved = applyPropertyEdit(ticket, { field: "groupId", value: "network" }, members);
    expect(undoBlocker({ ...moved, assigneeId: "lee" }, ticket, moved)).toBe("changed");
  });

  it("blocks undoing a status change the workflow would refuse to reverse", () => {
    const closed = applyPropertyEdit(ticket, { field: "status", value: "CLOSED" }, members);
    expect(undoBlocker(closed, ticket, closed, ["CLOSED", "OPEN"])).toBe("workflow");
    expect(undoBlocker(closed, ticket, closed, ["CLOSED", "IN_PROGRESS"])).toBeNull();
  });

  it("does not consult the workflow for an edit that left the status alone", () => {
    expect(undoBlocker(after, before, after, ["IN_PROGRESS"])).toBeNull();
    expect(undoBlocker(after, before, after, [])).toBeNull();
  });
});
