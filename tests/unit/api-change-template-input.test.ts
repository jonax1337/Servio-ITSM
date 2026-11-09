import { describe, expect, it } from "vitest";
import {
  changeTemplateCreateSchema,
  changeTemplateData,
  changeTemplatePatchSchema,
  changeTemplateProblem,
  changeTemplateUpsertSchema,
  serializeChangeTemplate,
} from "@/lib/api-change-template-input";
import { STANDARD_TEMPLATE_PLANS_MESSAGE } from "@/lib/change-template-rules";

describe("changeTemplateCreateSchema", () => {
  it("accepts a standard change with its plans", () => {
    const parsed = changeTemplateCreateSchema.parse({
      name: "Patch Linux servers",
      title: "Monthly patching",
      type: "STANDARD",
      risk: "LOW",
      implementation_plan: "1. Snapshot\n2. Patch",
      rollback_plan: "Revert the snapshot",
      service_id: "s1",
      import_ref: "runbook:patch-linux",
    });
    expect(parsed.name).toBe("Patch Linux servers");
  });

  it("needs name and title and is strict", () => {
    expect(changeTemplateCreateSchema.safeParse({ name: "Patch" }).success).toBe(false);
    expect(changeTemplateCreateSchema.safeParse({ title: "Patch" }).success).toBe(false);
    expect(changeTemplateCreateSchema.safeParse({ name: "Patch", title: "Patch", implementationPlan: "x" }).success).toBe(false);
    expect(changeTemplateCreateSchema.safeParse({ name: "Patch", title: "Patch", risk: "EXTREME" }).success).toBe(false);
    expect(changeTemplateCreateSchema.safeParse({ name: "Patch", title: "Patch", type: "EMERGENCY" }).success).toBe(false);
  });

  it("refuses an empty patch and a body import_ref on upsert", () => {
    expect(changeTemplatePatchSchema.safeParse({}).success).toBe(false);
    expect(changeTemplateUpsertSchema.safeParse({ import_ref: "x" }).success).toBe(false);
  });
});

describe("changeTemplateProblem", () => {
  const standard = { type: "STANDARD", implementationPlan: "Do it", rollbackPlan: "Undo it" };

  it("judges the merged template, not only the body", () => {
    expect(changeTemplateProblem(standard, changeTemplateData({ title: "New title" }))).toBeNull();
    expect(changeTemplateProblem(standard, changeTemplateData({ rollback_plan: null }))).toEqual({
      implementation_plan: [STANDARD_TEMPLATE_PLANS_MESSAGE], rollback_plan: [STANDARD_TEMPLATE_PLANS_MESSAGE],
    });
    expect(changeTemplateProblem({ ...standard, rollbackPlan: null }, changeTemplateData({ type: "NORMAL" }))).toBeNull();
  });

  it("treats a new template as STANDARD unless told otherwise", () => {
    expect(changeTemplateProblem(null, changeTemplateData({ name: "x", title: "y" }))).not.toBeNull();
    expect(changeTemplateProblem(null, changeTemplateData({ type: "NORMAL" }))).toBeNull();
  });
});

describe("changeTemplateData / serializeChangeTemplate", () => {
  it("maps snake_case to columns and back", () => {
    const data = changeTemplateData({ active: false, implementation_plan: "", category_id: null, summary: "When the disk is full" });
    expect(data).toEqual({ isActive: false, implementationPlan: null, categoryId: null, summary: "When the disk is full" });
    const now = new Date("2026-11-21T10:00:00Z");
    const out = serializeChangeTemplate({
      id: "t1", name: "Patch", summary: null, isActive: true, type: "STANDARD", title: "Patch", description: "",
      reason: null, implementationPlan: "a", rollbackPlan: "b", risk: "LOW", priority: "MEDIUM", impact: "LOW",
      categoryId: null, serviceId: "s1", groupId: null, importRef: "runbook:patch", createdAt: now, updatedAt: now,
    });
    expect(out).toMatchObject({ active: true, implementation_plan: "a", rollback_plan: "b", service_id: "s1", import_ref: "runbook:patch" });
  });
});
