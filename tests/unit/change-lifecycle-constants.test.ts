import { describe, expect, it } from "vitest";
import {
  ARTICLE_LINK_ENTITY_TYPES,
  CHANGE_OUTCOMES,
  CHANGE_OUTCOME_META,
  CHANGE_STATUSES,
  CHANGE_STATUS_META,
} from "@/lib/constants";
import { canTransition, CHANGE_TRANSITIONS } from "@/lib/transitions";

describe("change cancellation", () => {
  it("is appended after the existing statuses and has a label", () => {
    expect(CHANGE_STATUSES[CHANGE_STATUSES.length - 1]).toBe("CANCELLED");
    expect(CHANGE_STATUS_META.CANCELLED.label).toBe("Cancelled");
  });

  it("is reachable from every pre-execution state, and from nowhere else", () => {
    const cancellable = ["DRAFT", "APPROVAL", "APPROVED", "SCHEDULED", "REJECTED"];
    for (const from of CHANGE_STATUSES) {
      expect(canTransition(CHANGE_TRANSITIONS, from, "CANCELLED", true)).toBe(
        cancellable.includes(from) || from === "CANCELLED",
      );
    }
  });

  it("is terminal", () => {
    expect(CHANGE_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe("change outcomes and article links", () => {
  it("every outcome has a label", () => {
    for (const outcome of CHANGE_OUTCOMES) expect(CHANGE_OUTCOME_META[outcome].label).toBeTruthy();
  });

  it("articles link to tickets, problems and changes", () => {
    expect([...ARTICLE_LINK_ENTITY_TYPES]).toEqual(["TICKET", "PROBLEM", "CHANGE"]);
  });
});
