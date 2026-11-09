import { describe, expect, it } from "vitest";
import {
  changeCreateForm,
  changeCreateSchema,
  changeEditSteps,
  changePatchSchema,
  changeTransitionSchema,
  commentCreateSchema,
  formOf,
  problemEditSteps,
  problemPatchSchema,
  refusalStatus,
  snakeKeys,
  templateOverridesFrom,
} from "@/lib/api-itsm-input";

describe("change bodies", () => {
  it("fills create defaults like the console form, without baking them into the parsed body", () => {
    const b = changeCreateSchema.parse({ title: "Patch DC" });
    expect(b).toEqual({ title: "Patch DC" });
    const fd = changeCreateForm(b);
    expect(Object.fromEntries(["type", "risk", "priority", "impact"].map((k) => [k, fd.get(k)]))).toEqual({
      type: "NORMAL", risk: "MEDIUM", priority: "MEDIUM", impact: "MEDIUM",
    });
  });

  it("takes a template instead of a title, but not both references", () => {
    expect(changeCreateSchema.safeParse({}).success).toBe(false);
    expect(changeCreateSchema.safeParse({ template_id: "t1" }).success).toBe(true);
    expect(changeCreateSchema.safeParse({ template_ref: "tpl:rotate" }).success).toBe(true);
    expect(changeCreateSchema.safeParse({ template_id: "t1", template_ref: "tpl:rotate" }).success).toBe(false);
    expect(changeCreateSchema.safeParse({ template_ref: "bad ref" }).success).toBe(false);
    expect(changeCreateSchema.safeParse({ title: "ab", template_id: "t1" }).success).toBe(false);
  });

  it("turns a template body into overrides, keeping absent keys absent", () => {
    expect(templateOverridesFrom(changeCreateSchema.parse({ template_id: "t1" }))).toEqual({});
    expect(
      templateOverridesFrom(changeCreateSchema.parse({
        template_id: "t1", title: "Rotate the portal certificate", group_id: null, planned_start: "2026-12-01T10:00:00Z", assignee_id: "u2", rollback_plan: "",
      })),
    ).toEqual({ title: "Rotate the portal certificate", groupId: null, plannedStart: new Date("2026-12-01T10:00:00Z"), assigneeId: "u2", rollbackPlan: "" });
  });

  it("rejects unknown fields, so a typo cannot drop a rollback plan silently", () => {
    expect(changeCreateSchema.safeParse({ title: "Patch DC", rollback_plna: "x" }).success).toBe(false);
    expect(changePatchSchema.safeParse({ rollback_plna: "x" }).success).toBe(false);
  });

  it("refuses an empty PATCH and one carrying only reschedule metadata", () => {
    expect(changePatchSchema.safeParse({}).success).toBe(false);
    expect(changePatchSchema.safeParse({ reschedule_reason: "vendor delay" }).success).toBe(false);
  });

  it("requires timezone-qualified ISO times for the window", () => {
    expect(changeCreateSchema.safeParse({ title: "x".repeat(3), planned_start: "2026-11-08T10:00:00" }).success).toBe(false);
    expect(changeCreateSchema.safeParse({ title: "x".repeat(3), planned_start: "2026-11-08T10:00:00+01:00" }).success).toBe(true);
  });

  it("maps a create body onto the createChange form, assets repeated and custom fields as cf_", () => {
    const fd = changeCreateForm(
      changeCreateSchema.parse({ title: "Patch DC", rollback_plan: "snapshot", asset_ids: ["a1", "a2"], custom_fields: { ticket: 42 } }),
    );
    expect(fd.get("rollbackPlan")).toBe("snapshot");
    expect(fd.getAll("assetIds")).toEqual(["a1", "a2"]);
    expect(fd.get("cf_ticket")).toBe("42");
    expect(fd.has("plannedStart")).toBe(false);
  });

  it("only knows real statuses and outcomes in a transition", () => {
    expect(changeTransitionSchema.safeParse({ to: "CLOSED", outcome: "SUCCESSFUL" }).success).toBe(true);
    expect(changeTransitionSchema.safeParse({ to: "DONE" }).success).toBe(false);
    expect(changeTransitionSchema.safeParse({ to: "CLOSED", outcome: "GREAT" }).success).toBe(false);
  });
});

describe("changeEditSteps", () => {
  it("orders group before assignee, so both can change in one request", () => {
    const steps = changeEditSteps(changePatchSchema.parse({ assignee_id: "u1", group_id: "g1" }));
    expect(steps.map((s) => s.fields[0])).toEqual(["group_id", "assignee_id"]);
  });

  it("merges title and description into one details edit, and the window into one", () => {
    const steps = changeEditSteps(
      changePatchSchema.parse({ description: "d", planned_end: "2026-11-08T12:00:00Z", reschedule_reason: "r" }),
    );
    expect(steps).toEqual([
      { kind: "details", fields: ["description"], title: undefined, description: "d" },
      { kind: "window", fields: ["planned_end"], plannedStart: undefined, plannedEnd: "2026-11-08T12:00:00Z", reason: "r", justification: undefined },
    ]);
  });

  it("keeps null as clear for relations, plans and the problem link", () => {
    const steps = changeEditSteps(changePatchSchema.parse({ assignee_id: null, rollback_plan: null, problem_id: null }));
    expect(steps).toEqual([
      { kind: "field", fields: ["assignee_id"], field: "assigneeId", value: null },
      { kind: "text", fields: ["rollback_plan"], field: "rollbackPlan", value: null },
      { kind: "problem", fields: ["problem_id"], problemId: null },
    ]);
  });
});

describe("problemEditSteps", () => {
  it("routes root cause and workaround to the text action", () => {
    const steps = problemEditSteps(problemPatchSchema.parse({ root_cause: "disk full", priority: "HIGH" }));
    expect(steps.map((s) => [s.kind, s.fields[0]])).toEqual([["field", "priority"], ["text", "root_cause"]]);
  });

  it("does not accept a status (that is a transition)", () => {
    expect(problemPatchSchema.safeParse({ status: "RESOLVED" }).success).toBe(false);
  });
});

describe("comments", () => {
  it("defaults to an internal note and refuses a blank body", () => {
    expect(commentCreateSchema.parse({ body: "Recovered" })).toEqual({ body: "Recovered", internal: true });
    expect(commentCreateSchema.safeParse({ body: "   " }).success).toBe(false);
  });
});

describe("formOf", () => {
  it("drops undefined and turns null into the actions' clear value", () => {
    const fd = formOf({ a: undefined, b: null, c: 3, d: true });
    expect([...fd.keys()]).toEqual(["b", "c", "d"]);
    expect(fd.get("b")).toBe("");
    expect(fd.get("c")).toBe("3");
  });
});

describe("refusalStatus", () => {
  it.each([
    ["Change not found.", 404],
    ["Not authorised.", 403],
    ["Only managers can change the approval board.", 403],
    ["You can't change this ticket — it belongs to a group you're not a member of.", 403],
    ["Invalid request.", 422],
    ["The assignee must be a member of the change's group.", 422],
    ["A change cannot move from Draft to Closed.", 409],
    ["This change is in a change freeze.", 409],
  ] as const)("%s -> %i", (message, status) => {
    expect(refusalStatus(message)).toBe(status);
  });
});

describe("snakeKeys", () => {
  it("renames the actions' camelCase field errors", () => {
    expect(snakeKeys({ plannedEnd: ["x"], title: ["y"] })).toEqual({ planned_end: ["x"], title: ["y"] });
  });
});
