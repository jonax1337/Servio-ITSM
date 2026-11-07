import { describe, expect, it } from "vitest";
import {
  changeImportData,
  changeImportSchema,
  importCommentRows,
  importTimelineErrors,
  importUpdatedAt,
  problemImportSchema,
  referencedUserIds,
  ticketImportData,
  ticketImportSchema,
} from "@/lib/api-import-input";

const change = (extra: Record<string, unknown> = {}) =>
  changeImportSchema.parse({ import_ref: "glpi:change:129", title: "Servio pilot", status: "CLOSED", created_at: "2026-11-07T17:00:00+01:00", ...extra });

describe("import schemas", () => {
  it("need import_ref, status and created_at", () => {
    expect(changeImportSchema.safeParse({ title: "x", status: "CLOSED", created_at: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(changeImportSchema.safeParse({ import_ref: "r", title: "x", created_at: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(problemImportSchema.safeParse({ import_ref: "r", title: "x", status: "RESOLVED" }).success).toBe(false);
  });

  it("accept any final status, also ones the console never sets by hand", () => {
    expect(change({ status: "APPROVED" }).status).toBe("APPROVED");
    expect(change({ status: "FAILED", outcome: "ROLLED_BACK" }).outcome).toBe("ROLLED_BACK");
  });

  it("allow a one-character title from the source system but reject unknown fields", () => {
    expect(change({ title: "X" }).title).toBe("X");
    expect(changeImportSchema.safeParse({ ...change(), glpi_id: 129 }).success).toBe(false);
  });

  it("default comments to internal notes", () => {
    expect(change({ comments: [{ body: "done", created_at: "2026-11-07T18:00:00Z" }] }).comments[0].internal).toBe(true);
  });

  it("know ticket statuses and resolution codes", () => {
    const t = ticketImportSchema.parse({ import_ref: "glpi:ticket:1", title: "t", status: "CLOSED", resolution_code: "FIXED", created_at: "2026-01-01T00:00:00Z" });
    expect(t.type).toBe("INCIDENT");
    expect(ticketImportSchema.safeParse({ import_ref: "r", title: "t", status: "DONE", created_at: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("importUpdatedAt", () => {
  it("uses updated_at when given", () => {
    expect(importUpdatedAt(change({ updated_at: "2026-11-08T00:00:00Z" })).toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("otherwise takes the latest timestamp, including comments", () => {
    const b = change({ actual_end: "2026-11-07T17:30:00Z", comments: [{ body: "late note", created_at: "2026-11-09T08:00:00Z" }] });
    expect(importUpdatedAt(b).toISOString()).toBe("2026-11-09T08:00:00.000Z");
  });
});

describe("importTimelineErrors", () => {
  it("is empty for a consistent record", () => {
    expect(importTimelineErrors(change({ actual_start: "2026-11-07T17:10:00+01:00", actual_end: "2026-11-07T17:20:00+01:00" }))).toEqual({});
  });

  it("flags timestamps before creation and inverted windows", () => {
    const errors = importTimelineErrors(
      change({
        actual_end: "2026-11-07T15:00:00Z",
        planned_start: "2026-11-08T10:00:00Z",
        planned_end: "2026-11-08T09:00:00Z",
        comments: [{ body: "x", created_at: "2026-01-01T00:00:00Z" }],
      }),
    );
    expect(Object.keys(errors).sort()).toEqual(["actual_end", "comments.0.created_at", "planned_end"]);
  });
});

describe("data mapping", () => {
  it("defaults the creator and comment authors to the importing admin", () => {
    const b = change({ comments: [{ body: "a", created_at: "2026-11-07T18:00:00Z" }, { body: "b", author_id: "u2", created_at: "2026-11-07T18:05:00Z" }] });
    expect(changeImportData(b, "admin").createdById).toBe("admin");
    expect(importCommentRows(b, "admin").map((c) => c.authorId)).toEqual(["admin", "u2"]);
  });

  it("collects every referenced user once", () => {
    const b = change({ assignee_id: "u1", created_by_id: "u1", comments: [{ body: "a", author_id: "u3", created_at: "2026-11-07T18:00:00Z" }] });
    expect(referencedUserIds(b)).toEqual(["u1", "u3"]);
  });

  it("maps a ticket with its prefix, requester default and closure stamps", () => {
    const b = ticketImportSchema.parse({ import_ref: "glpi:ticket:7", title: "Printer", type: "REQUEST", status: "CLOSED", created_at: "2026-01-01T00:00:00Z", closed_at: "2026-01-02T00:00:00Z" });
    const d = ticketImportData(b, "admin", "REQ");
    expect(d).toMatchObject({ prefix: "REQ", requesterId: "admin", source: "API", importRef: "glpi:ticket:7" });
    expect(d.closedAt?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});
