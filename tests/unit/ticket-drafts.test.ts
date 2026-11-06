import { describe, expect, it } from "vitest";
import { canDraftArticleFrom, problemDraftFromTickets } from "@/lib/ticket-drafts";

const incident = (id: number, title: string, description = "") => ({ id, prefix: "INC", title, description });

describe("problemDraftFromTickets", () => {
  it("prefills a single incident with its title and description, naming the source", () => {
    const draft = problemDraftFromTickets([incident(63, "Printer on floor 2 jams", "Jams on every second page.")]);
    expect(draft.title).toBe("Printer on floor 2 jams");
    expect(draft.description).toBe("Jams on every second page.\n\nRaised from INC-0063.");
  });

  it("names the source even when the incident has no description", () => {
    expect(problemDraftFromTickets([incident(63, "Printer jams")]).description).toBe("Raised from INC-0063.");
  });

  it("names a selection after its lowest ticket id and lists every ticket", () => {
    const draft = problemDraftFromTickets([incident(9, "Printer jams B"), incident(3, "Printer jams A")]);
    expect(draft.title).toBe("Recurring: Printer jams A");
    expect(draft.description).toBe("Raised from 2 related incidents:\n- INC-0003: Printer jams A\n- INC-0009: Printer jams B");
  });

  it("keeps a long title to one line of the lists", () => {
    expect(problemDraftFromTickets([incident(1, "x".repeat(300))]).title).toHaveLength(120);
  });

  it("is empty for an empty selection", () => {
    expect(problemDraftFromTickets([])).toEqual({ title: "", description: "" });
  });
});

describe("canDraftArticleFrom", () => {
  it.each([
    ["RESOLVED", true],
    ["CLOSED", true],
    ["IN_PROGRESS", false],
    ["CANCELLED", false],
    ["NEW", false],
  ])("%s -> %s", (status, expected) => {
    expect(canDraftArticleFrom(status)).toBe(expected);
  });
});
