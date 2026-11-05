import { describe, expect, it } from "vitest";
import { approvalAllowsStatus, canTransition, CHANGE_TRANSITIONS, PROBLEM_TRANSITIONS, TICKET_TRANSITIONS } from "@/lib/transitions";

// A catalog request awaiting approval must not be worked or fulfilled before the
// approver decides — the only move left to agents is cancelling it.
describe("approvalAllowsStatus", () => {
  it.each(["OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED"])("blocks %s while approval is pending", (to) => {
    expect(approvalAllowsStatus("PENDING", to)).toBe(false);
  });

  it("allows cancelling a request that is awaiting approval", () => {
    expect(approvalAllowsStatus("PENDING", "CANCELLED")).toBe(true);
  });

  // A request cancelled while awaiting approval must not be reopened past the
  // approval it never received.
  it.each(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"])("keeps a withdrawn (CANCELLED) approval from being worked: %s", (to) => {
    expect(approvalAllowsStatus("CANCELLED", to)).toBe(false);
  });

  it.each([null, undefined, "APPROVED", "REJECTED"])("does not restrict tickets whose approval state is %s", (state) => {
    expect(approvalAllowsStatus(state, "RESOLVED")).toBe(true);
  });
});

// The raw built-in maps document the INTENDED lifecycle: the admin-configured
// layer (lib/workflow.ts) may only narrow these, never widen them.

describe("built-in transition maps", () => {
  it("active states can move to the working set", () => {
    expect(canTransition(TICKET_TRANSITIONS, "NEW", "OPEN")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "NEW", "IN_PROGRESS")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "OPEN", "PENDING")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "ON_HOLD", "IN_PROGRESS")).toBe(true);
  });

  it("direct CLOSED/CANCELLED shortcuts are allowed from active states", () => {
    // Legitimate agent shortcut via the resolution dialog.
    expect(canTransition(TICKET_TRANSITIONS, "NEW", "CLOSED")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "OPEN", "CANCELLED")).toBe(true);
  });

  it("RESOLVED can close or reopen, but not silently resume work", () => {
    expect(canTransition(TICKET_TRANSITIONS, "RESOLVED", "CLOSED")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "RESOLVED", "OPEN")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "RESOLVED", "IN_PROGRESS")).toBe(false);
  });

  it("terminal states can only reopen", () => {
    expect(TICKET_TRANSITIONS.CLOSED).toEqual(["OPEN"]);
    expect(TICKET_TRANSITIONS.CANCELLED).toEqual(["OPEN"]);
    expect(canTransition(TICKET_TRANSITIONS, "CLOSED", "IN_PROGRESS")).toBe(false);
  });

  it("every known status has an entry", () => {
    for (const s of ["NEW", "OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"]) {
      expect(Array.isArray(TICKET_TRANSITIONS[s])).toBe(true);
    }
  });

  it("problem map: CLOSED reopens to INVESTIGATING", () => {
    expect(PROBLEM_TRANSITIONS.CLOSED).toEqual(["INVESTIGATING"]);
    expect(PROBLEM_TRANSITIONS.NEW).toContain("KNOWN_ERROR");
  });

  it("change map: APPROVED is reachable only via CAB approval or explicit rework", () => {
    expect(CHANGE_TRANSITIONS.DRAFT).toEqual(["CANCELLED"]);
    // No pre-approval state may jump straight to APPROVED — the CAB flow
    // (decideApproval) is the only way to get there.
    for (const from of ["DRAFT", "APPROVAL", "REJECTED"]) {
      expect(CHANGE_TRANSITIONS[from]).not.toContain("APPROVED");
    }
    // SCHEDULED may fall back to APPROVED (rework), which is deliberate.
    expect(CHANGE_TRANSITIONS.SCHEDULED).toContain("APPROVED");
    expect(CHANGE_TRANSITIONS.CLOSED).toEqual([]);
  });

  it("same-state is a no-op true; unknown sources fail OPEN by default", () => {
    // from === to short-circuits to true (a no-op move is always allowed).
    expect(canTransition(TICKET_TRANSITIONS, "NEW", "NEW")).toBe(true);
    // Unknown/renamed source: tickets fail open so a migration never freezes
    // records; governed flows opt into failClosed.
    expect(canTransition(TICKET_TRANSITIONS, "BOGUS", "OPEN")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "BOGUS", "OPEN", true)).toBe(false);
  });
});
