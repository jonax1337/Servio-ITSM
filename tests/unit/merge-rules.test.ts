import { describe, expect, it } from "vitest";
import {
  MERGE_REFUSALS, adoptedId, foreignRequesterLabel, mergeRefusal, mergeTargetRefusal, mergedStatusRefusal, missingFrom,
  parseMovedAttachments, mergeDepthRefusal, parseNumberIds, parseStringIds, planAttachmentRestore, planChildRestore,
  planCommentCopy, planMergeLinks, undoClockData, unmergeRefusal,
} from "@/lib/merge-rules";
import { HIERARCHY_REFUSALS, MAX_HIERARCHY_DEPTH } from "@/lib/ticket-hierarchy-rules";

const openSource = { mergedIntoId: null, status: "OPEN" };
const openTarget = { id: 2, mergedIntoId: null, status: "OPEN" };

describe("mergeRefusal", () => {
  it("accepts an open ticket merged into an unrelated open ticket", () => {
    expect(mergeRefusal(1, openSource, openTarget, [2])).toBeNull();
  });

  it("refuses a ticket that is already merged", () => {
    expect(mergeRefusal(1, { mergedIntoId: 5, status: "CANCELLED" }, openTarget, [2])).toBe(MERGE_REFUSALS.sourceMerged);
  });

  it("refuses a cancelled source", () => {
    expect(mergeRefusal(1, { mergedIntoId: null, status: "CANCELLED" }, openTarget, [2])).toBe(MERGE_REFUSALS.sourceCancelled);
  });

  it("refuses a cancelled target", () => {
    expect(mergeRefusal(1, openSource, { ...openTarget, status: "CANCELLED" }, [2])).toBe(MERGE_REFUSALS.targetUnavailable);
  });

  it("refuses a target that was merged away, even when its status looks open", () => {
    expect(mergeRefusal(1, openSource, { ...openTarget, mergedIntoId: 9 }, [2])).toBe(MERGE_REFUSALS.targetUnavailable);
  });

  it("refuses a target below the source, at any depth", () => {
    expect(mergeRefusal(1, openSource, openTarget, [2, 3, 1])).toBe(MERGE_REFUSALS.targetBelowSource);
  });
});

describe("unmergeRefusal", () => {
  const active = { targetId: 2 };

  it("allows undoing an active merge whose target is still in place", () => {
    expect(unmergeRefusal({ activeMerge: active, sourceMergedIntoId: 2, targetMergedIntoId: null })).toBeNull();
  });

  it("refuses when no active merge is recorded", () => {
    expect(unmergeRefusal({ activeMerge: null, sourceMergedIntoId: 2, targetMergedIntoId: null })).toBe(MERGE_REFUSALS.noActiveMerge);
  });

  it("refuses when the target was merged into something else afterwards", () => {
    expect(unmergeRefusal({ activeMerge: active, sourceMergedIntoId: 2, targetMergedIntoId: 7 })).toBe(MERGE_REFUSALS.targetMergedAgain);
  });

  it("refuses when the source no longer points at the recorded target", () => {
    expect(unmergeRefusal({ activeMerge: active, sourceMergedIntoId: null, targetMergedIntoId: null })).toBe(MERGE_REFUSALS.mergedElsewhere);
  });
});

describe("mergedStatusRefusal", () => {
  it("refuses to reopen or progress a merged ticket", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) {
      expect(mergedStatusRefusal({ mergedIntoId: 2 }, status)).toBe(MERGE_REFUSALS.mergedTicketStatus);
    }
  });

  it("lets a merged ticket stay cancelled", () => {
    expect(mergedStatusRefusal({ mergedIntoId: 2 }, "CANCELLED")).toBeNull();
  });

  it("leaves tickets that were never merged alone", () => {
    expect(mergedStatusRefusal({ mergedIntoId: null }, "OPEN")).toBeNull();
  });
});

describe("missingFrom", () => {
  it("returns only what the target does not hold yet", () => {
    expect(missingFrom(["a", "b"], ["b", "c", "d"])).toEqual(["c", "d"]);
  });

  it("returns each value once", () => {
    expect(missingFrom([], ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns nothing when the target holds everything", () => {
    expect(missingFrom(["a"], ["a"])).toEqual([]);
  });
});

describe("adoptedId", () => {
  it("adopts the source's value when the target has none", () => {
    expect(adoptedId(null, 4)).toBe(4);
  });

  it("keeps the target's own value", () => {
    expect(adoptedId(3, 4)).toBeNull();
  });

  it("adopts nothing when neither has one", () => {
    expect(adoptedId(null, null)).toBeNull();
  });
});

describe("planMergeLinks", () => {
  const link = (ticketId: number, linkedTicketId: number, type = "RELATED") => ({ ticketId, linkedTicketId, type });
  const crossLink = link(2, 1, "DUPLICATE");

  it("re-creates the source's outgoing link on the target with the same type", () => {
    expect(planMergeLinks(1, 2, [link(1, 5, "BLOCKS")], [])).toEqual([link(2, 5, "BLOCKS"), crossLink]);
  });

  it("keeps the direction of an incoming link", () => {
    expect(planMergeLinks(1, 2, [link(5, 1, "CAUSED_BY")], [])).toEqual([link(5, 2, "CAUSED_BY"), crossLink]);
  });

  it("skips a link between the source and the target (no self-link)", () => {
    expect(planMergeLinks(1, 2, [link(1, 2)], [link(1, 2)])).toEqual([]);
  });

  it("skips a pair the target already has, in either direction", () => {
    expect(planMergeLinks(1, 2, [link(1, 5), link(1, 6)], [link(5, 2), link(2, 6)])).toEqual([crossLink]);
  });

  it("creates one link when the source is linked to the same ticket twice", () => {
    expect(planMergeLinks(1, 2, [link(1, 5), link(5, 1)], [])).toEqual([link(2, 5), crossLink]);
  });

  it("adds no cross-link when the two are already linked", () => {
    expect(planMergeLinks(1, 2, [], [link(2, 1, "RELATED")])).toEqual([]);
  });

  it("cross-links source and target as duplicates when nothing links them yet", () => {
    expect(planMergeLinks(1, 2, [], [])).toEqual([crossLink]);
  });
});

describe("recorded id lists", () => {
  it("reads string and number ids back", () => {
    expect(parseStringIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseNumberIds("[3,4]")).toEqual([3, 4]);
  });

  it("ignores values of the wrong type", () => {
    expect(parseStringIds('["a",1,null]')).toEqual(["a"]);
    expect(parseNumberIds('[1,"2"]')).toEqual([1]);
  });

  it("treats broken or non-array JSON as empty", () => {
    expect(parseStringIds("not json")).toEqual([]);
    expect(parseStringIds('{"a":1}')).toEqual([]);
  });

  it("reads moved attachments and drops malformed entries", () => {
    expect(parseMovedAttachments('[{"id":"f1","commentId":"c1"},{"id":"f2","commentId":null},{"commentId":"c3"},"x"]'))
      .toEqual([{ id: "f1", commentId: "c1" }, { id: "f2", commentId: null }]);
  });
});

describe("planAttachmentRestore", () => {
  it("puts a comment file back on its comment and a ticket file back on the ticket", () => {
    const moved = [{ id: "f1", commentId: "c1" }, { id: "f2", commentId: null }];
    expect(planAttachmentRestore(moved, new Set(["c1"]), 7)).toEqual([
      { id: "f1", ticketId: null, commentId: "c1" },
      { id: "f2", ticketId: 7, commentId: null },
    ]);
  });

  it("returns a file whose comment is gone to the ticket", () => {
    expect(planAttachmentRestore([{ id: "f1", commentId: "c1" }], new Set(), 7))
      .toEqual([{ id: "f1", ticketId: 7, commentId: null }]);
  });
});

describe("planChildRestore", () => {
  it("puts every moved child back when none is an ancestor of the source", () => {
    expect(planChildRestore([10, 11], [1, 5, 6])).toEqual({ restore: [10, 11], kept: [] });
  });

  it("keeps a moved child that is now the source's parent", () => {
    expect(planChildRestore([10, 11], [1, 10])).toEqual({ restore: [11], kept: [10] });
  });

  it("keeps a moved child that is a higher ancestor of the source", () => {
    expect(planChildRestore([10, 11], [1, 12, 11])).toEqual({ restore: [10], kept: [11] });
  });

  it("restores nothing when the merge moved no children", () => {
    expect(planChildRestore([], [1, 10])).toEqual({ restore: [], kept: [] });
  });
});

describe("mergeDepthRefusal", () => {
  it("allows a source without children whatever the target's depth", () => {
    expect(mergeDepthRefusal(MAX_HIERARCHY_DEPTH + 1, 0)).toBeNull();
  });

  it("allows children that still fit below the target", () => {
    expect(mergeDepthRefusal(5, 4)).toBeNull();
  });

  it("refuses children that would end up past the depth limit", () => {
    expect(mergeDepthRefusal(5, 6)).toBe(HIERARCHY_REFUSALS.tooDeep);
  });

  it("matches the limit parentLinkRefusal applies to the deepest child", () => {
    expect(mergeDepthRefusal(MAX_HIERARCHY_DEPTH - 1, 2)).toBe(HIERARCHY_REFUSALS.tooDeep);
    expect(mergeDepthRefusal(MAX_HIERARCHY_DEPTH - 1, 1)).toBeNull();
  });
});

describe("mergeTargetRefusal", () => {
  it("accepts a live target outside the source's subtree", () => {
    expect(mergeTargetRefusal(1, { mergedIntoId: null, status: "OPEN" }, [2, 3])).toBeNull();
  });

  it("refuses a target merged away meanwhile (opposite-direction merge)", () => {
    expect(mergeTargetRefusal(1, { mergedIntoId: 1, status: "CANCELLED" }, [2])).toBe(MERGE_REFUSALS.targetUnavailable);
  });

  it("refuses a target cancelled meanwhile", () => {
    expect(mergeTargetRefusal(1, { mergedIntoId: null, status: "CANCELLED" }, [2])).toBe(MERGE_REFUSALS.targetUnavailable);
  });

  it("refuses a target that has the source among its ancestors (cycle)", () => {
    expect(mergeTargetRefusal(1, { mergedIntoId: null, status: "OPEN" }, [2, 1])).toBe(MERGE_REFUSALS.targetBelowSource);
  });
});

describe("foreignRequesterLabel", () => {
  const source = { requesterId: "u1", requester: { name: "Jane Doe", email: "jane@example.com" } };

  it("is null for the same requester", () => {
    expect(foreignRequesterLabel(source, "u1")).toBeNull();
  });

  it("names the source's requester when the target belongs to someone else", () => {
    expect(foreignRequesterLabel(source, "u2")).toBe("Jane Doe");
  });

  it("falls back to the email for a requester without a name", () => {
    expect(foreignRequesterLabel({ ...source, requester: { name: null, email: "jane@example.com" } }, "u2")).toBe("jane@example.com");
  });
});

describe("planCommentCopy", () => {
  it("keeps the visibility of a comment copied to the same requester", () => {
    expect(planCommentCopy({ isInternal: false, body: "Hi" }, "INC-1", null)).toEqual({ isInternal: false, body: "[from INC-1] Hi" });
    expect(planCommentCopy({ isInternal: true, body: "Note" }, "INC-1", null)).toEqual({ isInternal: true, body: "[from INC-1] Note" });
  });

  it("makes a public comment internal and names the requester when the requesters differ", () => {
    expect(planCommentCopy({ isInternal: false, body: "Hi" }, "INC-1", "Jane Doe"))
      .toEqual({ isInternal: true, body: "[from INC-1 (requester Jane Doe)] Hi" });
  });

  it("keeps an internal comment internal when the requesters differ", () => {
    expect(planCommentCopy({ isInternal: true, body: "Note" }, "INC-1", "Jane Doe").isInternal).toBe(true);
  });
});

describe("undoClockData", () => {
  const mergedAt = new Date("2026-01-01T10:00:00Z");
  const now = new Date("2026-01-01T12:00:00Z");
  const clock = {
    responseDueAt: new Date("2026-01-01T11:00:00Z"),
    resolveDueAt: new Date("2026-01-02T10:00:00Z"),
    dueAt: new Date("2026-01-02T10:00:00Z"),
    pendingSince: null,
    pausedMs: 1000,
  };

  it("shifts the deadlines by the time spent merged and banks it as paused time", () => {
    expect(undoClockData(clock, "OPEN", mergedAt, now, null)).toEqual({
      pendingSince: null,
      pausedMs: 1000 + 2 * 3_600_000,
      responseDueAt: new Date("2026-01-01T13:00:00Z"),
      resolveDueAt: new Date("2026-01-02T12:00:00Z"),
      dueAt: new Date("2026-01-02T12:00:00Z"),
    });
  });

  it("leaves a ticket that was paused before the merge alone: its own resume credits the time", () => {
    expect(undoClockData({ ...clock, pendingSince: new Date("2026-01-01T09:00:00Z") }, "PENDING", mergedAt, now, null)).toEqual({});
    expect(undoClockData(clock, "ON_HOLD", mergedAt, now, null)).toEqual({});
  });

  it("leaves a finished ticket's frozen clock alone", () => {
    expect(undoClockData(clock, "RESOLVED", mergedAt, now, null)).toEqual({});
    expect(undoClockData(clock, "CLOSED", mergedAt, now, null)).toEqual({});
  });
});
