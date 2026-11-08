import { describe, expect, it } from "vitest";
import {
  apiFieldName,
  changeImportData,
  changeImportSchema,
  changeReimportSchema,
  commentsToAdd,
  importCommentRefErrors,
  importCommentRows,
  importRefFromPath,
  importTimelineErrors,
  importUpdatedAt,
  importValidationErrors,
  planReimport,
  problemImportSchema,
  problemReimportSchema,
  referencedUserIds,
  reimportColumns,
  reimportRefErrors,
  ticketImportData,
  ticketImportSchema,
  ticketReimportSchema,
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

describe("comment import_ref", () => {
  it("is optional, stored on the row and must be unique within a record", () => {
    const b = change({ comments: [{ import_ref: "glpi:followup:1", body: "a", created_at: "2026-11-07T18:00:00Z" }, { body: "b", created_at: "2026-11-07T18:05:00Z" }] });
    expect(importCommentRows(b, "admin").map((c) => c.importRef)).toEqual(["glpi:followup:1", null]);
    expect(importValidationErrors(b)).toEqual({});
    const dup = change({ comments: [{ import_ref: "f1", body: "a", created_at: "2026-11-07T18:00:00Z" }, { import_ref: "f1", body: "b", created_at: "2026-11-07T18:05:00Z" }] });
    expect(Object.keys(importCommentRefErrors(dup))).toEqual(["comments.1.import_ref"]);
  });
});

describe("update mode: path and body ref", () => {
  it("reads the path segment, decoding it, and refuses what an import could never store", () => {
    expect(importRefFromPath("glpi%3Achange%3A129")).toBe("glpi:change:129");
    expect(importRefFromPath("glpi:change:129")).toBe("glpi:change:129");
    expect(importRefFromPath("100%")).toBe("100%");
    expect(importRefFromPath("")).toBeNull();
    expect(importRefFromPath("%20x")).toBeNull();
    expect(importRefFromPath("x".repeat(201))).toBeNull();
  });

  it("allows import_ref in the body only when it equals the path", () => {
    expect(reimportRefErrors("r1", undefined)).toEqual({});
    expect(reimportRefErrors("r1", "r1")).toEqual({});
    expect(Object.keys(reimportRefErrors("r1", "r2"))).toEqual(["import_ref"]);
  });

  it("has the import bodies without a required import_ref, still strict", () => {
    const body = { title: "x", status: "CLOSED", created_at: "2026-01-01T00:00:00Z" };
    expect(changeReimportSchema.safeParse(body).success).toBe(true);
    expect(changeReimportSchema.safeParse({ ...body, glpi_id: 1 }).success).toBe(false);
    expect(problemReimportSchema.safeParse({ ...body, status: "RESOLVED" }).success).toBe(true);
    expect(ticketReimportSchema.safeParse(body).success).toBe(true);
  });
});

const c = (body: string, created_at: string, import_ref?: string) => ({ body, created_at, internal: true, ...(import_ref ? { import_ref } : {}) });
const s = (body: string, at: string, importRef: string | null = null) => ({ body, createdAt: new Date(at), importRef });

describe("commentsToAdd", () => {
  it("adds only comments the record lacks, matching body + created_at to the millisecond", () => {
    const incoming = [c("planned", "2026-11-07T18:00:00+01:00"), c("done", "2026-11-08T09:00:00Z")];
    const stored = [s("planned", "2026-11-07T17:00:00.000Z")];
    expect(commentsToAdd(incoming, stored).map((x) => x.body)).toEqual(["done"]);
    expect(commentsToAdd([c("planned", "2026-11-07T17:00:00.001Z")], stored)).toHaveLength(1);
    expect(commentsToAdd([c("planned (edited)", "2026-11-07T17:00:00Z")], stored)).toHaveLength(1);
  });

  it("keeps two identical source comments as two", () => {
    const twice = [c("ping", "2026-11-07T18:00:00Z"), c("ping", "2026-11-07T18:00:00Z")];
    expect(commentsToAdd(twice, [s("ping", "2026-11-07T18:00:00Z")])).toHaveLength(1);
    expect(commentsToAdd(twice, [])).toHaveLength(2);
  });

  it("matches by import_ref first, whatever the body says now", () => {
    expect(commentsToAdd([c("edited in GLPI", "2026-11-07T18:00:00Z", "f1")], [s("original", "2026-11-07T18:00:00Z", "f1")])).toEqual([]);
  });

  it("lets a ref'd comment claim a legacy ref-less row by content, never another ref's row", () => {
    expect(commentsToAdd([c("a", "2026-11-07T18:00:00Z", "f1")], [s("a", "2026-11-07T18:00:00Z")])).toEqual([]);
    expect(commentsToAdd([c("a", "2026-11-07T18:00:00Z", "f1")], [s("a", "2026-11-07T18:00:00Z", "f2")])).toHaveLength(1);
    // a ref-less payload comment still matches a ref'd row with the same content
    expect(commentsToAdd([c("a", "2026-11-07T18:00:00Z")], [s("a", "2026-11-07T18:00:00Z", "f2")])).toEqual([]);
  });

  it("ignores comments written in Servio after the import (they stay, nothing is removed)", () => {
    const stored = [s("planned", "2026-11-07T18:00:00Z"), s("note added in Servio", "2026-11-09T10:00:00Z")];
    expect(commentsToAdd([c("planned", "2026-11-07T18:00:00Z")], stored)).toEqual([]);
  });
});

describe("planReimport", () => {
  const draft = change({ status: "DRAFT", comments: [{ body: "planned", created_at: "2026-11-07T18:00:00+01:00" }] });
  /** The stored row exactly as the first import wrote it. */
  const storedRow = (b: ReturnType<typeof change>) => ({ id: 1, ...changeImportData(b, "admin") });
  const storedComments = [s("planned", "2026-11-07T17:00:00Z")];
  const plan = (b: ReturnType<typeof change>, row: Record<string, unknown> = storedRow(draft), comments = storedComments) =>
    planReimport(b, reimportColumns(changeImportData(b, "other-admin"), b), row, comments);

  it("reports an identical payload as unchanged, also when run by another admin", () => {
    expect(plan(draft)).toMatchObject({ data: null, changed: [], comments: [], errors: {} });
  });

  it("closes the change and adds exactly the new comment", () => {
    const closed = change({
      status: "CLOSED",
      outcome: "SUCCESSFUL",
      closure_notes: "went fine",
      actual_end: "2026-11-08T08:00:00Z",
      comments: [{ body: "planned", created_at: "2026-11-07T18:00:00+01:00" }, { body: "closed", created_at: "2026-11-08T09:00:00Z" }],
    });
    const p = plan(closed);
    expect([...p.changed].sort()).toEqual(["actual_end", "closure_notes", "outcome", "status"]);
    expect(p.comments.map((x) => x.body)).toEqual(["closed"]);
    expect(p.data).toMatchObject({ status: "CLOSED", outcome: "SUCCESSFUL", closureNotes: "went fine" });
    // updated_at was not sent: it follows the latest timestamp of the payload
    expect((p.data!.updatedAt as Date).toISOString()).toBe("2026-11-08T09:00:00.000Z");
    expect(p.data).not.toHaveProperty("createdById");
  });

  it("writes when only a comment is new", () => {
    const more = change({ status: "DRAFT", comments: [{ body: "planned", created_at: "2026-11-07T18:00:00+01:00" }, { body: "+1", created_at: "2026-11-07T19:00:00Z" }] });
    const p = plan(more);
    expect(p.changed).toEqual([]);
    expect(p.comments).toHaveLength(1);
    expect(p.data).toEqual({ updatedAt: new Date("2026-11-07T19:00:00Z") });
  });

  it("replaces omitted optional fields with their import defaults (full state)", () => {
    const row = { ...storedRow(draft), risk: "HIGH", reason: "old reason" };
    expect([...plan(draft, row).changed].sort()).toEqual(["reason", "risk"]);
  });

  it("keeps the creator and custom fields unless sent; a sent creator or {} is applied", () => {
    const withFields = { ...storedRow(draft), customFields: JSON.stringify({ b: 2, a: 1 }) };
    expect(plan(draft, withFields).data).toBeNull();
    expect(plan(change({ ...draft, custom_fields: { a: 1, b: 2 } }), withFields).data).toBeNull();
    expect(plan(change({ ...draft, custom_fields: {} }), withFields).changed).toEqual(["custom_fields"]);
    expect(plan(change({ ...draft, created_by_id: "u9" })).changed).toEqual(["created_by_id"]);
  });

  it("treats an explicit, different updated_at as a change, a derived one never on its own", () => {
    expect(plan(change({ ...draft, updated_at: "2026-11-09T00:00:00Z" })).changed).toEqual(["updated_at"]);
    expect(plan(draft, { ...storedRow(draft), updatedAt: new Date("2026-12-01T00:00:00Z") }).data).toBeNull();
  });

  it("replaces created_at but refuses to move it past a comment the record keeps", () => {
    expect(plan(change({ ...draft, created_at: "2026-11-01T00:00:00Z" })).changed).toEqual(["created_at"]);
    const p = plan(change({ ...draft, created_at: "2026-11-07T17:30:00Z", comments: [] }));
    expect(Object.keys(p.errors)).toEqual(["created_at"]);
    expect(p.data).toBeNull();
  });

  it("leaves a ticket's prefix, source and requester alone", () => {
    const t = ticketImportSchema.parse({ import_ref: "glpi:ticket:7", title: "Printer", type: "REQUEST", status: "CLOSED", created_at: "2026-01-01T00:00:00Z" });
    const cols = reimportColumns(ticketImportData({ ...t, type: "INCIDENT" }, "other-admin", "INC"), t);
    for (const key of ["prefix", "source", "requesterId", "importRef", "updatedAt"]) expect(cols).not.toHaveProperty(key);
    expect(cols).toMatchObject({ type: "INCIDENT", status: "CLOSED" });
  });

  it("names changed columns in API spelling", () => {
    expect(apiFieldName("closureNotes")).toBe("closure_notes");
    expect(apiFieldName("firstResponseAt")).toBe("first_response_at");
    expect(apiFieldName("status")).toBe("status");
  });
});
