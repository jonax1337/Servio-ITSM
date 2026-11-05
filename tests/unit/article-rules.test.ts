import { describe, expect, it } from "vitest";
import {
  ARTICLE_TRANSITIONS,
  canLinkArticle,
  canMoveArticle,
  linkedRecordHref,
  linkedRecordRef,
  statusAfterEdit,
} from "@/lib/article-rules";
import { ARTICLE_STATUSES } from "@/lib/constants";

describe("canMoveArticle", () => {
  it("covers every article status", () => {
    expect(Object.keys(ARTICLE_TRANSITIONS).sort()).toEqual([...ARTICLE_STATUSES].sort());
  });

  it("lets a retired article be revised as a draft", () => {
    expect(canMoveArticle("RETIRED", "DRAFT")).toBe(true);
  });

  it("only retires or unpublishes a published article", () => {
    expect(canMoveArticle("PUBLISHED", "RETIRED")).toBe(true);
    expect(canMoveArticle("PUBLISHED", "DRAFT")).toBe(true);
    expect(canMoveArticle("PUBLISHED", "REVIEW")).toBe(false);
    expect(canMoveArticle("PUBLISHED", "PUBLISHED")).toBe(false);
  });

  it("refuses unknown statuses", () => {
    expect(canMoveArticle("ARCHIVED", "DRAFT")).toBe(false);
    expect(canMoveArticle("DRAFT", "ARCHIVED")).toBe(false);
  });
});

describe("statusAfterEdit", () => {
  it("keeps a published article published for a manager", () => {
    expect(statusAfterEdit("PUBLISHED", true)).toBe("PUBLISHED");
  });

  it("sends a published article back to review for an editor below manager", () => {
    expect(statusAfterEdit("PUBLISHED", false)).toBe("REVIEW");
  });

  it.each(["DRAFT", "REVIEW", "RETIRED"])("leaves a %s article alone", (status) => {
    expect(statusAfterEdit(status, false)).toBe(status);
    expect(statusAfterEdit(status, true)).toBe(status);
  });
});

describe("canLinkArticle", () => {
  it("allows published articles for anyone", () => {
    expect(canLinkArticle({ status: "PUBLISHED", authorId: "a" }, "b")).toBe(true);
  });

  it("allows only the author's own draft", () => {
    expect(canLinkArticle({ status: "DRAFT", authorId: "a" }, "a")).toBe(true);
    expect(canLinkArticle({ status: "DRAFT", authorId: "a" }, "b")).toBe(false);
    expect(canLinkArticle({ status: "DRAFT", authorId: null }, "a")).toBe(false);
  });

  it("refuses articles in review or retired", () => {
    expect(canLinkArticle({ status: "REVIEW", authorId: "a" }, "a")).toBe(false);
    expect(canLinkArticle({ status: "RETIRED", authorId: "a" }, "a")).toBe(false);
  });
});

describe("linked record refs", () => {
  it("builds a route per entity type", () => {
    expect(linkedRecordHref("TICKET", 7)).toBe("/tickets/7");
    expect(linkedRecordHref("PROBLEM", 7)).toBe("/problems/7");
    expect(linkedRecordHref("CHANGE", 7)).toBe("/changes/7");
  });

  it("labels records with their human reference", () => {
    expect(linkedRecordRef("TICKET", 7, "REQ")).toBe("REQ-0007");
    expect(linkedRecordRef("PROBLEM", 7)).toBe("PRB-0007");
    expect(linkedRecordRef("CHANGE", 7)).toBe("CHG-0007");
  });
});
