import { describe, expect, it } from "vitest";
import {
  isTemplatedStandard,
  isWindowEditable,
  leavesStandardProcedure,
  MANUAL_CHANGE_TYPES,
  plannedWindowError,
  preApprovalApplies,
  STANDARD_NEEDS_TEMPLATE_MESSAGE,
  standardDemotion,
  standardTypeError,
  submitBlockedMessage,
  submitBlockers,
  WINDOW_ORDER_ERROR,
} from "@/lib/change-rules";
import { refSearchWhere } from "@/lib/ref-search";
import { sortByRank, ticketListQuery } from "@/lib/ticket-list";

const at = (iso: string) => new Date(iso);

describe("plannedWindowError", () => {
  it("accepts an end after the start", () => {
    expect(plannedWindowError(at("2026-01-01T10:00"), at("2026-01-01T11:00"))).toBeNull();
  });

  it("rejects an end before or equal to the start", () => {
    expect(plannedWindowError(at("2026-01-01T11:00"), at("2026-01-01T10:00"))).toBe(WINDOW_ORDER_ERROR);
    expect(plannedWindowError(at("2026-01-01T10:00"), at("2026-01-01T10:00"))).toBe(WINDOW_ORDER_ERROR);
  });

  it("does not judge an incomplete window", () => {
    expect(plannedWindowError(null, at("2026-01-01T10:00"))).toBeNull();
    expect(plannedWindowError(at("2026-01-01T10:00"), null)).toBeNull();
    expect(plannedWindowError(null, null)).toBeNull();
  });
});

describe("submitBlockers", () => {
  const complete = {
    implementationPlan: "Deploy v2",
    rollbackPlan: "Redeploy v1",
    plannedStart: at("2026-01-01T10:00"),
    plannedEnd: at("2026-01-01T11:00"),
  };

  it("lets a fully planned change through", () => {
    expect(submitBlockers(complete, false)).toEqual([]);
  });

  it("names every missing prerequisite", () => {
    const missing = submitBlockers({ ...complete, implementationPlan: null, rollbackPlan: "  ", plannedEnd: null }, false);
    expect(missing).toEqual(["an implementation plan", "a rollback plan", "a planned window (start and end)"]);
    expect(submitBlockedMessage(missing)).toContain("an implementation plan, a rollback plan");
  });

  it("exempts a pre-approved standard change", () => {
    expect(submitBlockers({ implementationPlan: null, rollbackPlan: null, plannedStart: null, plannedEnd: null }, true)).toEqual([]);
  });

  it("still demands the plans of a change that is not pre-approved", () => {
    expect(submitBlockers({ implementationPlan: null, rollbackPlan: null, plannedStart: null, plannedEnd: null }, false)).toHaveLength(3);
  });
});

describe("standard changes come only from templates", () => {
  it("refuses giving a change the STANDARD type by hand", () => {
    expect(standardTypeError("STANDARD", null)).toBe(STANDARD_NEEDS_TEMPLATE_MESSAGE);
    expect(standardTypeError("STANDARD", "NORMAL")).toBe(STANDARD_NEEDS_TEMPLATE_MESSAGE);
  });

  it("lets other types through and keeps an existing STANDARD type", () => {
    expect(standardTypeError("NORMAL", null)).toBeNull();
    expect(standardTypeError("EMERGENCY", "STANDARD")).toBeNull();
    expect(standardTypeError("STANDARD", "STANDARD")).toBeNull();
  });

  it("offers STANDARD to no manual form", () => {
    expect(MANUAL_CHANGE_TYPES).toEqual(["NORMAL", "EMERGENCY"]);
  });
});

describe("preApprovalApplies", () => {
  const templated = { type: "STANDARD", templateId: "tpl-1" };
  const standardTemplate = { type: "STANDARD", isActive: true };

  it("approves a standard change whose active standard template exists", () => {
    expect(preApprovalApplies(templated, standardTemplate)).toBe(true);
  });

  it("does not approve a standard change without a template", () => {
    expect(preApprovalApplies({ type: "STANDARD", templateId: null }, null)).toBe(false);
  });

  it("does not approve when the template is switched off or no longer standard", () => {
    expect(preApprovalApplies(templated, { ...standardTemplate, isActive: false })).toBe(false);
    expect(preApprovalApplies(templated, { type: "NORMAL", isActive: true })).toBe(false);
    expect(preApprovalApplies(templated, null)).toBe(false);
  });

  it("never approves a normal change, even one made from a template", () => {
    expect(preApprovalApplies({ type: "NORMAL", templateId: "tpl-1" }, standardTemplate)).toBe(false);
  });
});

describe("isTemplatedStandard", () => {
  it("needs both the STANDARD type and a template", () => {
    expect(isTemplatedStandard({ type: "STANDARD", templateId: "tpl-1" })).toBe(true);
    expect(isTemplatedStandard({ type: "STANDARD", templateId: null })).toBe(false);
    expect(isTemplatedStandard({ type: "NORMAL", templateId: "tpl-1" })).toBe(false);
  });
});

describe("leavesStandardProcedure", () => {
  it("flags a changed plan, rollback plan, risk or impact", () => {
    expect(leavesStandardProcedure("implementationPlan", "new steps", "old steps")).toBe(true);
    expect(leavesStandardProcedure("rollbackPlan", null, "revert")).toBe(true);
    expect(leavesStandardProcedure("risk", "HIGH", "LOW")).toBe(true);
    expect(leavesStandardProcedure("impact", "HIGH", "LOW")).toBe(true);
  });

  it("ignores a save that changes nothing", () => {
    expect(leavesStandardProcedure("risk", "LOW", "LOW")).toBe(false);
    expect(leavesStandardProcedure("rollbackPlan", null, null)).toBe(false);
    expect(leavesStandardProcedure("implementationPlan", "", null)).toBe(false);
  });

  it("ignores fields the template does not fix", () => {
    expect(leavesStandardProcedure("reason", "other", "some")).toBe(false);
    expect(leavesStandardProcedure("priority", "HIGH", "LOW")).toBe(false);
  });

  it("flags moving the type away from STANDARD", () => {
    expect(leavesStandardProcedure("type", "NORMAL", "STANDARD")).toBe(true);
    expect(leavesStandardProcedure("type", "STANDARD", "STANDARD")).toBe(false);
  });
});

describe("standardDemotion", () => {
  const templated = { type: "STANDARD", templateId: "tpl-1" };

  it("sends a pre-approved templated change back to draft", () => {
    expect(standardDemotion({ ...templated, status: "APPROVED" })).toEqual({ backToDraft: true });
    expect(standardDemotion({ ...templated, status: "SCHEDULED" })).toEqual({ backToDraft: true });
  });

  it("only converts a templated draft", () => {
    expect(standardDemotion({ ...templated, status: "DRAFT" })).toEqual({ backToDraft: false });
  });

  it("leaves work that already started where it is", () => {
    expect(standardDemotion({ ...templated, status: "IN_PROGRESS" })).toEqual({ backToDraft: false });
  });

  it("does not touch changes that are not templated standard changes", () => {
    expect(standardDemotion({ type: "NORMAL", templateId: "tpl-1", status: "APPROVED" })).toBeNull();
    expect(standardDemotion({ type: "STANDARD", templateId: null, status: "APPROVED" })).toBeNull();
  });
});

describe("refSearchWhere", () => {
  const idMatch = (q: string, prefix: string) =>
    refSearchWhere(q, prefix).OR.flatMap((c) => ("id" in c ? [c.id] : []));

  it("resolves references, short forms and plain numbers to the id", () => {
    expect(idMatch("CHG-0025", "CHG")).toEqual([25]);
    expect(idMatch("chg-25", "CHG")).toEqual([25]);
    expect(idMatch("PRB-0019", "PRB")).toEqual([19]);
    expect(idMatch("19", "PRB")).toEqual([19]);
    expect(idMatch("#7", "CHG")).toEqual([7]);
  });

  it("skips the id match for numbers outside the 32-bit id range", () => {
    expect(idMatch("2147483647", "CHG")).toEqual([2147483647]);
    expect(idMatch("2147483648", "CHG")).toEqual([]);
    expect(idMatch("12345678901234567890", "CHG")).toEqual([]);
    expect(idMatch("0", "CHG")).toEqual([]);
  });

  it("always keeps the title match", () => {
    expect(refSearchWhere("CHG-0025", "CHG").OR[0]).toEqual({ title: { contains: "CHG-0025" } });
  });

  it("treats other text, or another record's prefix, as title-only", () => {
    expect(idMatch("database failover", "CHG")).toEqual([]);
    expect(idMatch("PRB-0019", "CHG")).toEqual([]);
    expect(idMatch("v2 rollout 3", "CHG")).toEqual([]);
  });
});

describe("sortByRank", () => {
  const row = (priority: string, status: string, minute = 0, id = 1) => ({
    id,
    priority,
    status,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
  });

  it("orders priority by severity, not alphabetically", () => {
    const rows = [row("LOW", "NEW"), row("CRITICAL", "NEW"), row("MEDIUM", "NEW"), row("HIGH", "NEW")];
    expect(sortByRank(rows, { key: "priority", dir: "desc" }).map((r) => r.priority)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(sortByRank(rows, { key: "priority", dir: "asc" }).map((r) => r.priority)).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("orders status by lifecycle position", () => {
    const rows = [row("LOW", "CLOSED"), row("LOW", "NEW"), row("LOW", "RESOLVED"), row("LOW", "IN_PROGRESS")];
    expect(sortByRank(rows, { key: "status", dir: "asc" }).map((r) => r.status)).toEqual(["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
  });

  it("breaks ties by newest activity and leaves the input untouched", () => {
    const older = row("HIGH", "NEW", 1);
    const newer = row("HIGH", "NEW", 5);
    const input = [older, newer];
    expect(sortByRank(input, { key: "priority", dir: "asc" })).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });

  it("breaks remaining ties by highest id so pages stay stable", () => {
    const rows = [row("HIGH", "NEW", 1, 1), row("HIGH", "NEW", 1, 3), row("HIGH", "NEW", 1, 2)];
    expect(sortByRank(rows, { key: "priority", dir: "asc" }).map((x) => x.id)).toEqual([3, 2, 1]);
  });
});

describe("ticketListQuery rank sorting", () => {
  it("flags priority and status sorts for in-memory ranking", () => {
    expect(ticketListQuery({ sort: "priority", dir: "asc" }).rankSort).toEqual({ key: "priority", dir: "asc" });
    expect(ticketListQuery({ sort: "status" }).rankSort).toEqual({ key: "status", dir: "desc" });
  });

  it("leaves other sorts to the database", () => {
    expect(ticketListQuery({ sort: "title" }).rankSort).toBeUndefined();
    expect(ticketListQuery({}).rankSort).toBeUndefined();
  });
});

describe("isWindowEditable", () => {
  it("allows edits before the CAB decides and as a reschedule once approved", () => {
    for (const status of ["DRAFT", "REJECTED", "APPROVED", "SCHEDULED"]) expect(isWindowEditable(status), status).toBe(true);
    for (const status of ["APPROVAL", "IN_PROGRESS", "REVIEW", "CLOSED", "FAILED", "CANCELLED"]) {
      expect(isWindowEditable(status), status).toBe(false);
    }
  });
});
