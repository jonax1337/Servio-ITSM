import { describe, expect, it } from "vitest";
import {
  blastRadiusRisk,
  planCompleteness,
  renderFacts,
  riskMismatch,
  type ChangeBriefFacts,
  type PlanSource,
} from "@/lib/change-brief-rules";

describe("blastRadiusRisk", () => {
  it("is low below three downstream CIs, medium from three, high from eight", () => {
    expect(blastRadiusRisk(0)).toBe("LOW");
    expect(blastRadiusRisk(2)).toBe("LOW");
    expect(blastRadiusRisk(3)).toBe("MEDIUM");
    expect(blastRadiusRisk(7)).toBe("MEDIUM");
    expect(blastRadiusRisk(8)).toBe("HIGH");
  });
});

describe("riskMismatch", () => {
  it("warns when the declared risk is lower than the blast radius", () => {
    expect(riskMismatch("LOW", 9)).toBe("Declared risk is low, but 9 downstream CIs suggest high.");
    expect(riskMismatch("MEDIUM", 8)).toContain("suggest high");
  });

  it("flags a low declaration from the medium threshold on", () => {
    expect(riskMismatch("LOW", 3)).toBe("Declared risk is low, but 3 downstream CIs suggest medium.");
    expect(riskMismatch("LOW", 2)).toBeNull();
  });

  it("stays silent when the declared risk matches or exceeds the blast radius", () => {
    expect(riskMismatch("HIGH", 9)).toBeNull();
    expect(riskMismatch("HIGH", 0)).toBeNull();
    expect(riskMismatch("MEDIUM", 3)).toBeNull();
  });
});

describe("planCompleteness", () => {
  const complete: PlanSource = {
    reason: "Patch Tuesday",
    implementationPlan: "1. Patch",
    rollbackPlan: "1. Restore",
    plannedStart: new Date("2026-11-10T20:00:00Z"),
    plannedEnd: new Date("2026-11-10T22:00:00Z"),
  };
  const doneLabels = (source: PlanSource, affected: number) =>
    planCompleteness(source, affected)
      .filter((item) => item.done)
      .map((item) => item.label);

  it("marks everything done for a fully planned change", () => {
    expect(planCompleteness(complete, 2).every((item) => item.done)).toBe(true);
  });

  it("treats blank text as missing", () => {
    const labels = doneLabels({ ...complete, implementationPlan: "   ", rollbackPlan: null, reason: "" }, 1);
    expect(labels).toEqual(["Planned window", "Affected CIs"]);
  });

  it("needs both ends of the window", () => {
    expect(doneLabels({ ...complete, plannedEnd: null }, 1)).not.toContain("Planned window");
    expect(doneLabels({ ...complete, plannedStart: null }, 1)).not.toContain("Planned window");
  });

  it("needs at least one affected CI", () => {
    expect(doneLabels(complete, 0)).not.toContain("Affected CIs");
  });
});

describe("renderFacts", () => {
  const facts: ChangeBriefFacts = {
    ref: "CHG-0007",
    title: "Upgrade the core switch",
    description: "Replace firmware",
    type: "NORMAL",
    status: "APPROVAL",
    risk: "HIGH",
    impact: "MEDIUM",
    reason: null,
    implementationPlan: null,
    rollbackPlan: "Reflash the old image",
    window: "not set",
    affected: [{ name: "core-sw-1", type: "NETWORK" }],
    impactedCount: 2,
    impactedSample: [{ name: "vpn-gw", type: "SERVER" }],
    plan: [],
    schedule: { conflicts: [{ ref: "CHG-0009", title: "Rack move" }], freezes: ["Year-end freeze"] },
    approvals: { approved: 1, rejected: 0, pending: 2, seated: 3, required: 3, satisfied: false, approvers: [] },
  };

  it("lists the facts of the record and flags what is missing", () => {
    const text = renderFacts(facts);
    expect(text).toContain("Change: CHG-0007 Upgrade the core switch");
    expect(text).toContain("Affected CIs (1): core-sw-1 (NETWORK)");
    expect(text).toContain("Downstream CIs reached by the impact analysis (2): vpn-gw (SERVER)");
    expect(text).toContain("Implementation plan: (missing)");
    expect(text).toContain("Rollback plan: Reflash the old image");
    expect(text).toContain("Schedule: overlaps with CHG-0009 Rack move; falls inside the freeze window Year-end freeze");
    expect(text).toContain("Approvals: 1/3 approvals needed, 2 pending, 0 rejected");
  });

  it("says so when the schedule is clear", () => {
    expect(renderFacts({ ...facts, schedule: { conflicts: [], freezes: [] } })).toContain("Schedule: no conflicts");
  });

  it("describes a standard change as pre-authorized", () => {
    expect(renderFacts({ ...facts, approvals: null })).toContain("pre-authorized");
  });

  it("clips very long free text", () => {
    const text = renderFacts({ ...facts, description: "x".repeat(5000) });
    expect(text).toContain("x".repeat(3000) + "…");
    expect(text).not.toContain("x".repeat(3001));
  });
});
