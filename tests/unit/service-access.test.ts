import { describe, expect, it } from "vitest";
import { agentMayUpdateField, canManageServices, inUseRefusal } from "@/lib/service-access";

describe("canManageServices", () => {
  it("allows managers and admins only", () => {
    expect(canManageServices("ADMIN")).toBe(true);
    expect(canManageServices("MANAGER")).toBe(true);
    expect(canManageServices("AGENT")).toBe(false);
    expect(canManageServices("USER")).toBe(false);
    expect(canManageServices(undefined)).toBe(false);
    expect(canManageServices("")).toBe(false);
  });
});

describe("agentMayUpdateField", () => {
  it("lets agents change only the status", () => {
    expect(agentMayUpdateField("status")).toBe(true);
    for (const f of ["criticality", "categoryId", "ownerId", "slaId", "groupId"]) expect(agentMayUpdateField(f)).toBe(false);
  });
});

describe("inUseRefusal", () => {
  it("is null when nothing references the service", () => {
    expect(inUseRefusal({})).toBeNull();
  });
  it("names the references and suggests RETIRED", () => {
    const r = inUseRefusal({ tickets: 2 });
    expect(r?.references).toEqual({ tickets: 2 });
    expect(r?.suggestion).toEqual({ status: "RETIRED" });
    expect(r?.message).toContain("RETIRED");
  });
});
