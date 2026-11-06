import { describe, expect, it } from "vitest";
import {
  JOIN_REFUSALS,
  PUBLIC_COPY_REFUSAL,
  canPublishStatusIncident,
  isActiveIncidentState,
  joinRefusal,
  publicCopyRefusal,
  publishedAtFor,
  resolvedAtFor,
  worstImpact,
} from "@/lib/status-rules";
import { STATUS_INCIDENT_STATES } from "@/lib/constants";

const now = new Date("2026-11-05T12:00:00Z");
const earlier = new Date("2026-11-05T09:00:00Z");

describe("canPublishStatusIncident", () => {
  it("allows managers and admins only", () => {
    expect(canPublishStatusIncident("ADMIN")).toBe(true);
    expect(canPublishStatusIncident("MANAGER")).toBe(true);
    expect(canPublishStatusIncident("AGENT")).toBe(false);
    expect(canPublishStatusIncident("USER")).toBe(false);
  });
});

describe("publicCopyRefusal", () => {
  const published = { title: "Email delays", summary: "Mail is slow", impact: "MINOR", isPublic: true };
  const same = { title: "Email delays", summary: "Mail is slow", impact: "MINOR" };

  it("refuses an agent rewording a public incident", () => {
    expect(publicCopyRefusal("AGENT", published, { ...same, title: "Email outage" })).toBe(PUBLIC_COPY_REFUSAL);
    expect(publicCopyRefusal("AGENT", published, { ...same, summary: "Mail is down" })).toBe(PUBLIC_COPY_REFUSAL);
    expect(publicCopyRefusal("AGENT", published, { ...same, impact: "MAJOR" })).toBe(PUBLIC_COPY_REFUSAL);
  });

  it("lets an agent save a public incident whose wording stays the same", () => {
    expect(publicCopyRefusal("AGENT", published, same)).toBeNull();
  });

  it("treats a blank summary and no summary as the same", () => {
    expect(publicCopyRefusal("AGENT", { ...published, summary: null }, { ...same, summary: "" })).toBeNull();
  });

  it("lets managers and admins reword a public incident", () => {
    expect(publicCopyRefusal("MANAGER", published, { ...same, title: "Email outage" })).toBeNull();
    expect(publicCopyRefusal("ADMIN", published, { ...same, impact: "MAJOR" })).toBeNull();
  });

  it("lets an agent edit a draft freely", () => {
    expect(publicCopyRefusal("AGENT", { ...published, isPublic: false }, { ...same, title: "Email outage" })).toBeNull();
  });
});

describe("isActiveIncidentState", () => {
  it("treats every state but RESOLVED as active", () => {
    for (const state of STATUS_INCIDENT_STATES) expect(isActiveIncidentState(state)).toBe(state !== "RESOLVED");
  });
});

describe("resolvedAtFor", () => {
  it("stamps a newly resolved incident and keeps an existing stamp", () => {
    expect(resolvedAtFor("RESOLVED", null, now)).toEqual(now);
    expect(resolvedAtFor("RESOLVED", earlier, now)).toEqual(earlier);
  });

  it("clears the stamp when the incident is reopened", () => {
    expect(resolvedAtFor("INVESTIGATING", earlier, now)).toBeNull();
    expect(resolvedAtFor("MONITORING", null, now)).toBeNull();
  });
});

describe("publishedAtFor", () => {
  it("stamps the first publication only", () => {
    expect(publishedAtFor(true, null, now)).toEqual(now);
    expect(publishedAtFor(true, earlier, now)).toEqual(earlier);
  });

  it("keeps the first publication when retracted", () => {
    expect(publishedAtFor(false, earlier, now)).toEqual(earlier);
    expect(publishedAtFor(false, null, now)).toBeNull();
  });
});

describe("worstImpact", () => {
  it("picks the most severe impact", () => {
    expect(worstImpact(["MINOR", "CRITICAL", "MAJOR"])).toBe("CRITICAL");
    expect(worstImpact(["NONE", "MINOR"])).toBe("MINOR");
  });

  it("is NONE for no incidents or unknown values", () => {
    expect(worstImpact([])).toBe("NONE");
    expect(worstImpact(["BOGUS"])).toBe("NONE");
  });
});

describe("joinRefusal", () => {
  const joinable = { isPublic: true, state: "INVESTIGATING", ticket: { status: "OPEN", isMajorIncident: true } };

  it("accepts a public, active incident with an open ticket", () => {
    expect(joinRefusal(joinable)).toBeNull();
    expect(joinRefusal({ ...joinable, state: "MONITORING", ticket: { status: "RESOLVED", isMajorIncident: true } })).toBeNull();
  });

  it("refuses drafts and resolved incidents", () => {
    expect(joinRefusal({ ...joinable, isPublic: false })).toBe(JOIN_REFUSALS.notActive);
    expect(joinRefusal({ ...joinable, state: "RESOLVED" })).toBe(JOIN_REFUSALS.notActive);
  });

  it("refuses an incident without a ticket", () => {
    expect(joinRefusal({ ...joinable, ticket: null })).toBe(JOIN_REFUSALS.noTicket);
  });

  it("refuses a ticket that is not a major incident", () => {
    expect(joinRefusal({ ...joinable, ticket: { status: "OPEN", isMajorIncident: false } })).toBe(JOIN_REFUSALS.noTicket);
  });

  it("refuses a closed or cancelled ticket", () => {
    expect(joinRefusal({ ...joinable, ticket: { status: "CLOSED", isMajorIncident: true } })).toBe(JOIN_REFUSALS.ticketClosed);
    expect(joinRefusal({ ...joinable, ticket: { status: "CANCELLED", isMajorIncident: true } })).toBe(JOIN_REFUSALS.ticketClosed);
  });
});
