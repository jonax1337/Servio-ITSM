import { describe, expect, it } from "vitest";
import { inlineBadgeMeta, recordRefHref, remarkStateBadges } from "@/lib/inline-badge";
import {
  APPROVAL_META,
  CHANGE_STATUS_META,
  CHANGE_TYPE_META,
  PRIORITY_META,
  SLA_STATE_META,
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

describe("remarkStateBadges", () => {
  type Node = { type: string; value?: string; children?: Node[] };
  const paragraph = (...children: Node[]): Node => ({ type: "root", children: [{ type: "paragraph", children }] });
  const run = (tree: Node) => {
    remarkStateBadges()(tree);
    return tree.children![0].children!;
  };

  it("turns a bare upper-case state in prose into a badge token", () => {
    expect(run(paragraph({ type: "text", value: "Typ: NORMAL, Risiko MEDIUM." }))).toEqual([
      { type: "text", value: "Typ: " },
      { type: "inlineCode", value: "state:NORMAL" },
      { type: "text", value: ", Risiko " },
      { type: "inlineCode", value: "state:MEDIUM" },
      { type: "text", value: "." },
    ]);
  });

  it("resolves the badge token to the matching tone badge", () => {
    expect(inlineBadgeMeta("state:BREACHED")).toBe(SLA_STATE_META.BREACHED);
    expect(inlineBadgeMeta("state:IN_PROGRESS")).toBe(TICKET_STATUS_META.IN_PROGRESS);
  });

  it("leaves lower-case words, refs, acronyms and English look-alikes alone", () => {
    const text = "Medium risk, INC-0142, VPN and CU, NONE MET";
    expect(run(paragraph({ type: "text", value: text }))).toEqual([{ type: "text", value: text }]);
  });

  it("leaves shouted phrases and headings alone", () => {
    const shouted = "REQUEST FAILED after retry";
    expect(run(paragraph({ type: "text", value: shouted }))).toEqual([{ type: "text", value: shouted }]);
    const heading: Node = { type: "heading", children: [{ type: "text", value: "OPEN items" }] };
    expect(run(paragraph(heading))).toEqual([heading]);
  });

  it("never rewrites code or link text", () => {
    const link: Node = { type: "link", children: [{ type: "text", value: "OPEN" }] };
    const code: Node = { type: "inlineCode", value: "OPEN" };
    expect(run(paragraph(link, code))).toEqual([link, code]);
  });
});
