import { describe, expect, it } from "vitest";
import { inlineBadgeMeta, recordRefHref } from "@/lib/inline-badge";
import {
  APPROVAL_META,
  CHANGE_STATUS_META,
  CHANGE_TYPE_META,
  PRIORITY_META,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
} from "@/lib/constants";

describe("inlineBadgeMeta", () => {
  it("maps a namespaced ticket status to its badge", () => {
    expect(inlineBadgeMeta("status:OPEN")).toBe(TICKET_STATUS_META.OPEN);
  });

  it("uses the namespace to tell identical values apart", () => {
    expect(inlineBadgeMeta("change:APPROVED")).toBe(CHANGE_STATUS_META.APPROVED);
    expect(inlineBadgeMeta("approval:APPROVED")).toBe(APPROVAL_META.APPROVED);
  });

  it("resolves a plain type to the ticket or change type", () => {
    expect(inlineBadgeMeta("type:NORMAL")).toBe(CHANGE_TYPE_META.NORMAL);
    expect(inlineBadgeMeta("type:INCIDENT")).toBe(TICKET_TYPE_META.INCIDENT);
  });

  it("accepts lower-case values", () => {
    expect(inlineBadgeMeta("priority:high")).toBe(PRIORITY_META.HIGH);
  });

  it("leaves ordinary inline code alone", () => {
    expect(inlineBadgeMeta("OPEN")).toBeNull();
    expect(inlineBadgeMeta("search_changes")).toBeNull();
    expect(inlineBadgeMeta("http://example.com")).toBeNull();
  });

  it("rejects unknown namespaces and values", () => {
    expect(inlineBadgeMeta("colour:RED")).toBeNull();
    expect(inlineBadgeMeta("status:NOT_A_STATUS")).toBeNull();
  });
});

describe("recordRefHref", () => {
  it("links each record ref to its page", () => {
    expect(recordRefHref("INC-0142")).toBe("/tickets/142");
    expect(recordRefHref("REQ-0007")).toBe("/tickets/7");
    expect(recordRefHref("PRB-0019")).toBe("/problems/19");
    expect(recordRefHref("chg-0039")).toBe("/changes/39");
  });

  it("ignores anything that is not exactly a ref", () => {
    expect(recordRefHref("INC-0142 and more")).toBeNull();
    expect(recordRefHref("KB-12")).toBeNull();
    expect(recordRefHref("status:OPEN")).toBeNull();
  });
});
