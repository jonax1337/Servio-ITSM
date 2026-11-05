import { describe, expect, it } from "vitest";
import {
  HIERARCHY_REFUSALS, MAX_HIERARCHY_DEPTH, ancestorChain, childResolutionMessage, descendantIds, openChildren,
  parentLinkRefusal, refusedChildrenDetail, subtreeHeight,
} from "@/lib/ticket-hierarchy-rules";

const openParent = { status: "OPEN", mergedIntoId: null };

describe("parentLinkRefusal", () => {
  it("accepts an open parent with no ancestors", () => {
    expect(parentLinkRefusal(1, openParent, [2])).toBeNull();
  });

  it("accepts a parent that sits under other tickets", () => {
    expect(parentLinkRefusal(1, openParent, [2, 3, 4])).toBeNull();
  });

  it("refuses a ticket as its own parent", () => {
    expect(parentLinkRefusal(1, openParent, [1])).toBe(HIERARCHY_REFUSALS.self);
  });

  it("refuses a parent that is already the ticket's child", () => {
    // 2's parent is 1: making 2 the parent of 1 closes a loop.
    expect(parentLinkRefusal(1, openParent, [2, 1])).toBe(HIERARCHY_REFUSALS.cycle);
  });

  it("refuses a parent that is a deeper descendant of the ticket", () => {
    expect(parentLinkRefusal(1, openParent, [4, 3, 2, 1])).toBe(HIERARCHY_REFUSALS.cycle);
  });

  it.each(["CLOSED", "CANCELLED"])("refuses a %s parent", (status) => {
    expect(parentLinkRefusal(1, { status, mergedIntoId: null }, [2])).toBe(HIERARCHY_REFUSALS.parentFinished);
  });

  it.each(["NEW", "PENDING", "ON_HOLD", "RESOLVED"])("allows a %s parent", (status) => {
    expect(parentLinkRefusal(1, { status, mergedIntoId: null }, [2])).toBeNull();
  });

  it("refuses a merged parent even when its status is not terminal", () => {
    expect(parentLinkRefusal(1, { status: "OPEN", mergedIntoId: 9 }, [2])).toBe(HIERARCHY_REFUSALS.parentMerged);
  });

  it("allows the deepest permitted chain and refuses one level more", () => {
    const fits = Array.from({ length: MAX_HIERARCHY_DEPTH - 1 }, (_, i) => i + 2);
    expect(parentLinkRefusal(1, openParent, fits)).toBeNull();
    expect(parentLinkRefusal(1, openParent, [...fits, 99])).toBe(HIERARCHY_REFUSALS.tooDeep);
  });
});

describe("openChildren", () => {
  it("keeps only children that still need work", () => {
    const children = [
      { id: 1, status: "NEW" },
      { id: 2, status: "RESOLVED" },
      { id: 3, status: "PENDING" },
      { id: 4, status: "CLOSED" },
      { id: 5, status: "CANCELLED" },
      { id: 6, status: "ON_HOLD" },
    ];
    expect(openChildren(children).map((c) => c.id)).toEqual([1, 3, 6]);
  });

  it("returns nothing for no children", () => {
    expect(openChildren([])).toEqual([]);
  });
});

describe("childResolutionMessage", () => {
  it("is null when no child was involved", () => {
    expect(childResolutionMessage(0, 0)).toBeNull();
  });

  it("counts resolved children, singular and plural", () => {
    expect(childResolutionMessage(1, 0)).toBe("resolved 1 child ticket");
    expect(childResolutionMessage(3, 0)).toBe("resolved 3 child tickets");
  });

  it("reports children the workflow refused", () => {
    expect(childResolutionMessage(2, 1)).toBe("resolved 2 child tickets, 1 child ticket could not be resolved");
    expect(childResolutionMessage(0, 2)).toBe("2 child tickets could not be resolved");
  });
});

describe("parentLinkRefusal with a subtree", () => {
  it("refuses a ticket whose own children would end up too deep", () => {
    const ancestors = Array.from({ length: MAX_HIERARCHY_DEPTH - 2 }, (_, i) => i + 2);
    expect(parentLinkRefusal(1, openParent, ancestors, 1)).toBeNull();
    expect(parentLinkRefusal(1, openParent, ancestors, 2)).toBe(HIERARCHY_REFUSALS.tooDeep);
  });
});

describe("hierarchy walks", () => {
  // 1 <- 2 <- 3, 1 <- 4, 5 stands alone
  const edges = [
    { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 1 },
  ];

  it("lists a ticket followed by its ancestors", () => {
    expect(ancestorChain(3, edges)).toEqual([3, 2, 1]);
    expect(ancestorChain(5, edges)).toEqual([5]);
  });

  it("stops walking cyclic data", () => {
    const cycle = [{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }];
    expect(ancestorChain(1, cycle)).toHaveLength(MAX_HIERARCHY_DEPTH + 1);
  });

  it("collects descendants at any depth", () => {
    expect([...descendantIds(1, edges)].sort()).toEqual([2, 3, 4]);
    expect(descendantIds(3, edges).size).toBe(0);
  });

  it("terminates on cyclic data", () => {
    expect([...descendantIds(1, [{ id: 2, parentId: 1 }, { id: 1, parentId: 2 }])].sort()).toEqual([1, 2]);
  });

  it("measures how many levels sit below a ticket", () => {
    expect(subtreeHeight(1, edges)).toBe(2);
    expect(subtreeHeight(2, edges)).toBe(1);
    expect(subtreeHeight(3, edges)).toBe(0);
    expect(subtreeHeight(5, edges)).toBe(0);
  });

  it("terminates the height of cyclic data", () => {
    expect(subtreeHeight(1, [{ id: 2, parentId: 1 }, { id: 1, parentId: 2 }])).toBe(1);
  });
});

describe("refusedChildrenDetail", () => {
  it("names every refused child with its reason, one per line", () => {
    expect(refusedChildrenDetail([{ ref: "INC-7", error: "Not allowed." }, { ref: "REQ-2", error: "Awaiting approval." }]))
      .toBe("INC-7: Not allowed.\nREQ-2: Awaiting approval.");
  });
});
