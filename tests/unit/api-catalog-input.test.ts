import { describe, expect, it } from "vitest";
import {
  catalogItemCreateSchema,
  catalogItemData,
  catalogItemPatchSchema,
  catalogItemUpsertSchema,
  catalogQuestionSchema,
  catalogQuestionsSchema,
  questionsJson,
  serializeCatalogItem,
  stagesJson,
} from "@/lib/api-catalog-input";
import { parseFormSchema } from "@/lib/service-forms";

const questions = [
  { key: "kind", label: "Hardware or software?", type: "select", options: ["Hardware", "Software"], required: true },
  { key: "model", label: "Model", type: "text", required: true, condition: { field: "kind", values: ["Hardware"] } },
];

describe("catalogItemCreateSchema", () => {
  it("accepts a full item with a branching form", () => {
    const parsed = catalogItemCreateSchema.parse({
      name: " New laptop ",
      service_id: "s1",
      category_id: "c1",
      group_id: "g1",
      ticket_type: "INCIDENT",
      title_template: "{{item}} for {{requester}}",
      requires_approval: true,
      approval_stages: [{ approver_id: "u1" }, { group_id: "g2" }],
      questions,
      import_ref: "catalog:new-laptop",
    });
    expect(parsed.name).toBe("New laptop");
    expect(parsed.questions).toHaveLength(2);
  });

  it("is strict and refuses camelCase or unknown keys, also inside questions", () => {
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", serviceId: "s1" }).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", questions: [{ ...questions[0], showIf: {} }] }).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", questions: [{ ...questions[1], condition: { field: "kind", values: ["x"], op: "eq" } }] }).success).toBe(false);
  });

  it("needs a name and checks types and refs", () => {
    expect(catalogItemCreateSchema.safeParse({}).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", ticket_type: "PROBLEM" }).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", import_ref: "has/slash" }).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", approval_stages: [{ approver_id: "u1", group_id: "g1" }] }).success).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: "Laptop", approval_stages: [{}] }).success).toBe(false);
  });
});

describe("catalogQuestionsSchema", () => {
  it("refuses a condition on a later question or with an answer the source does not offer", () => {
    const later = catalogQuestionsSchema.safeParse([questions[1], questions[0]]);
    expect(later.success).toBe(false);
    expect(later.error?.issues[0]?.message).toBe("Question 1: the condition must refer to an earlier question.");
    const wrong = catalogQuestionsSchema.safeParse([questions[0], { ...questions[1], condition: { field: "kind", values: ["Firmware"] } }]);
    expect(wrong.error?.issues[0]?.message).toBe("Question 2: the condition names an answer the earlier question does not offer.");
  });

  it("refuses bad keys, duplicate keys and empty labels", () => {
    expect(catalogQuestionsSchema.safeParse([{ ...questions[0], key: "has space" }]).success).toBe(false);
    expect(catalogQuestionsSchema.safeParse([questions[0], { ...questions[0] }]).success).toBe(false);
    expect(catalogQuestionsSchema.safeParse([{ ...questions[0], label: " " }]).success).toBe(false);
  });
});

describe("catalogItemPatchSchema / catalogItemUpsertSchema", () => {
  it("refuses an empty patch but allows clearing", () => {
    expect(catalogItemPatchSchema.safeParse({}).success).toBe(false);
    expect(catalogItemPatchSchema.parse({ group_id: null, import_ref: null })).toEqual({ group_id: null, import_ref: null });
  });

  it("takes the ref from the path, not the body", () => {
    expect(catalogItemUpsertSchema.safeParse({ import_ref: "x" }).success).toBe(false);
    expect(catalogItemUpsertSchema.safeParse({}).success).toBe(true);
  });
});

describe("catalogItemData", () => {
  it("maps only the fields that were sent, blank text to null", () => {
    expect(catalogItemData({ name: "Laptop" })).toEqual({ name: "Laptop" });
    expect(catalogItemData({ short_description: "", published: false, order: 3, group_id: null, title_template: "" })).toEqual({
      shortDescription: null, isPublished: false, order: 3, groupId: null, titleTemplate: null,
    });
  });

  it("stores questions and stages in the console's shape", () => {
    const parsed = catalogItemCreateSchema.parse({ name: "Laptop", questions, approval_stages: [{ group_id: "g1" }] });
    const data = catalogItemData(parsed);
    expect(parseFormSchema(data.formSchema)).toEqual([
      { key: "kind", label: "Hardware or software?", type: "select", options: ["Hardware", "Software"], required: true },
      { key: "model", label: "Model", type: "text", required: true, condition: { field: "kind", values: ["Hardware"] } },
    ]);
    expect(data.approvalStages).toBe('[{"groupId":"g1"}]');
    expect(stagesJson([])).toBeNull();
    expect(questionsJson([])).toBe("[]");
  });
});

describe("serializeCatalogItem", () => {
  it("round-trips what a create stored", () => {
    const parsed = catalogItemCreateSchema.parse({ name: "Laptop", questions, approval_stages: [{ approver_id: "u1" }] });
    const now = new Date("2026-11-21T10:00:00Z");
    const out = serializeCatalogItem({
      id: "c1", name: "Laptop", description: null, shortDescription: null, icon: null, categoryId: null, serviceId: "s1",
      groupId: "g1", ticketType: "REQUEST", titleTemplate: null, estimatedDays: 3, isPublished: true, order: 0,
      requiresApproval: true, approverId: "u1", approvalStages: catalogItemData(parsed).approvalStages ?? null,
      formSchema: catalogItemData(parsed).formSchema!, importRef: "catalog:laptop", createdAt: now, updatedAt: now,
    });
    expect(out.approval_stages).toEqual([{ approver_id: "u1" }]);
    expect(out.questions[1]).toEqual({ key: "model", label: "Model", type: "text", required: true, condition: { field: "kind", values: ["Hardware"] } });
    expect(out.questions[0].condition).toBeNull();
    expect(out).toMatchObject({ group_id: "g1", published: true, import_ref: "catalog:laptop", created_at: now.toISOString() });
    // What GET returns is accepted back by PATCH (minus the read-only fields).
    const writable: Record<string, unknown> = { ...out };
    for (const readOnly of ["id", "created_at", "updated_at"]) delete writable[readOnly];
    expect(catalogItemPatchSchema.safeParse(writable).success).toBe(true);
  });
});

describe("separators in options and condition values", () => {
  const question = { key: "q", label: "Q", type: "select" as const };

  it("refuses a comma, semicolon or line break in an option", () => {
    for (const bad of ["a,b", "a;b", "a\nb"]) {
      expect(catalogQuestionSchema.safeParse({ ...question, options: [bad] }).success, bad).toBe(false);
    }
    expect(catalogQuestionSchema.safeParse({ ...question, options: ["Laptop", "Dock 2"] }).success).toBe(true);
  });

  it("refuses them in a condition value too", () => {
    const condition = (v: string) => ({ ...question, key: "r", condition: { field: "q", values: [v] } });
    expect(catalogQuestionSchema.safeParse(condition("a,b")).success).toBe(false);
    expect(catalogQuestionSchema.safeParse(condition("Laptop")).success).toBe(true);
  });
});
