import { describe, expect, it } from "vitest";
import { isWindowEditable, plannedWindowError, submitBlockedMessage, submitBlockers, WINDOW_ORDER_ERROR } from "@/lib/change-rules";
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
    type: "NORMAL",
    implementationPlan: "Deploy v2",
    rollbackPlan: "Redeploy v1",
    plannedStart: at("2026-01-01T10:00"),
    plannedEnd: at("2026-01-01T11:00"),
  };

  it("lets a fully planned change through", () => {
    expect(submitBlockers(complete)).toEqual([]);
  });

  it("names every missing prerequisite", () => {
    const missing = submitBlockers({ ...complete, implementationPlan: null, rollbackPlan: "  ", plannedEnd: null });
    expect(missing).toEqual(["an implementation plan", "a rollback plan", "a planned window (start and end)"]);
    expect(submitBlockedMessage(missing)).toContain("an implementation plan, a rollback plan");
  });

  it("applies to emergency changes too", () => {
    expect(submitBlockers({ ...complete, type: "EMERGENCY", rollbackPlan: null })).toEqual(["a rollback plan"]);
  });

  it("exempts pre-authorized STANDARD changes", () => {
    expect(submitBlockers({ type: "STANDARD", implementationPlan: null, rollbackPlan: null, plannedStart: null, plannedEnd: null })).toEqual([]);
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
