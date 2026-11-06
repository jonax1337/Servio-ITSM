import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  isPreAuthorized,
  STANDARD_TEMPLATE_PLANS_MESSAGE,
  templateProblem,
  type ChangeTemplateDefaults,
} from "@/lib/change-template-rules";

const standard: ChangeTemplateDefaults = {
  type: "STANDARD",
  title: "Rotate TLS certificate",
  description: "Replace the expiring certificate.",
  reason: "Certificate expires soon",
  implementationPlan: "1. Install new cert",
  rollbackPlan: "1. Reinstall old cert",
  risk: "LOW",
  priority: "MEDIUM",
  impact: "LOW",
  categoryId: "cat-1",
  groupId: "grp-1",
};

const normal: ChangeTemplateDefaults = { ...standard, type: "NORMAL", risk: "MEDIUM" };

describe("isPreAuthorized", () => {
  it("applies to STANDARD templates only", () => {
    expect(isPreAuthorized("STANDARD")).toBe(true);
    expect(isPreAuthorized("NORMAL")).toBe(false);
  });
});

describe("templateProblem", () => {
  it("requires both plans on a standard template", () => {
    expect(templateProblem({ type: "STANDARD", implementationPlan: "x", rollbackPlan: "y" })).toBeNull();
    expect(templateProblem({ type: "STANDARD", implementationPlan: null, rollbackPlan: "y" })).toBe(STANDARD_TEMPLATE_PLANS_MESSAGE);
    expect(templateProblem({ type: "STANDARD", implementationPlan: "x", rollbackPlan: "  " })).toBe(STANDARD_TEMPLATE_PLANS_MESSAGE);
  });

  it("does not require plans on a normal template", () => {
    expect(templateProblem({ type: "NORMAL", implementationPlan: null, rollbackPlan: null })).toBeNull();
  });
});

describe("applyTemplate", () => {
  it("prefills everything from the template", () => {
    expect(applyTemplate(standard, {})).toEqual({
      ...standard,
      assigneeId: null,
      plannedStart: null,
      plannedEnd: null,
    });
  });

  it("lets the requester edit title, description, reason, scope and window", () => {
    const start = new Date("2026-03-01T20:00:00Z");
    const end = new Date("2026-03-01T21:00:00Z");
    const change = applyTemplate(standard, {
      title: "Rotate cert for shop",
      description: "Shop only",
      reason: null,
      groupId: null,
      categoryId: "cat-2",
      assigneeId: "u-1",
      priority: "HIGH",
      plannedStart: start,
      plannedEnd: end,
    });
    expect(change).toMatchObject({
      title: "Rotate cert for shop",
      description: "Shop only",
      reason: null,
      groupId: null,
      categoryId: "cat-2",
      assigneeId: "u-1",
      priority: "HIGH",
      plannedStart: start,
      plannedEnd: end,
    });
  });

  it("falls back to the template title when the title is blank", () => {
    expect(applyTemplate(standard, { title: "   " }).title).toBe(standard.title);
  });

  it("keeps the pre-authorized procedure of a standard template", () => {
    const change = applyTemplate(standard, {
      risk: "HIGH",
      impact: "HIGH",
      implementationPlan: "rm -rf",
      rollbackPlan: "none",
    });
    expect(change).toMatchObject({
      type: "STANDARD",
      risk: "LOW",
      impact: "LOW",
      implementationPlan: standard.implementationPlan,
      rollbackPlan: standard.rollbackPlan,
    });
  });

  it("lets a normal template be tuned per change", () => {
    const change = applyTemplate(normal, { risk: "HIGH", impact: "HIGH", implementationPlan: "custom", rollbackPlan: "" });
    expect(change).toMatchObject({
      type: "NORMAL",
      risk: "HIGH",
      impact: "HIGH",
      implementationPlan: "custom",
      rollbackPlan: null,
    });
  });
});
