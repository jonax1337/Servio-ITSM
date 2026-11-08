import { describe, expect, it } from "vitest";
import { OPEN_TICKET_STATUSES, TICKET_STATUSES } from "@/lib/constants";
import { camelizeBody } from "@/lib/api-case";
import { duplicateCommentText, ticketCreateSchema, ticketResolveSchema } from "@/lib/api-ticket-input";
import {
  EXTERNAL_REF_OPEN_STATUSES,
  EXTERNAL_REF_RE,
  holdsExternalRef,
  isOpenExternalRefConflict,
  parseExternalRef,
  releaseExternalRef,
  releaseExternalRefMany,
} from "@/lib/ticket-external-ref";

describe("external reference format", () => {
  it("accepts the keys monitoring integrations send", () => {
    for (const ref of ["zabbix:event:12345", "wazuh:rule:92206:host:pc-042", "a", "host.lan@site_1-x"]) {
      expect(EXTERNAL_REF_RE.test(ref)).toBe(true);
    }
  });

  it("rejects slashes, spaces, a leading symbol and more than 200 characters", () => {
    for (const ref of ["", "a/b", "a b", ":lead", "-x", "x".repeat(201), "ü"]) {
      expect(EXTERNAL_REF_RE.test(ref)).toBe(false);
    }
    expect(EXTERNAL_REF_RE.test("x".repeat(200))).toBe(true);
  });

  it("decodes a route segment and refuses an invalid or malformed one", () => {
    expect(parseExternalRef("zabbix%3Aevent%3A1")).toBe("zabbix:event:1");
    expect(parseExternalRef("zabbix:event:1")).toBe("zabbix:event:1");
    expect(parseExternalRef("a%2Fb")).toBeNull();
    expect(parseExternalRef("%E0%A4%A")).toBeNull();
  });
});

describe("which statuses hold the key", () => {
  it("are exactly the open ticket statuses", () => {
    expect([...EXTERNAL_REF_OPEN_STATUSES].sort()).toEqual([...OPEN_TICKET_STATUSES].sort());
    for (const s of TICKET_STATUSES) expect(holdsExternalRef(s)).toBe((OPEN_TICKET_STATUSES as readonly string[]).includes(s));
  });
});

describe("releaseExternalRef (applied to every ticket write in lib/db.ts)", () => {
  it.each(["RESOLVED", "CLOSED", "CANCELLED"])("clears openExternalRef on %s", (status) => {
    expect(releaseExternalRef({ status, resolvedAt: 1 })).toEqual({ status, resolvedAt: 1, openExternalRef: null });
    expect(releaseExternalRef({ status: { set: status } })).toEqual({ status: { set: status }, openExternalRef: null });
  });

  it("leaves writes into an open status or without a status untouched (same object)", () => {
    for (const data of [{ status: "OPEN" }, { status: "PENDING" }, { status: { set: "NEW" } }, { priority: "HIGH" }, { updatedAt: new Date() }]) {
      expect(releaseExternalRef(data)).toBe(data);
    }
  });

  it("does not resurrect a key on reopen and overrides a caller's own value on a terminal write", () => {
    expect(releaseExternalRef({ status: "OPEN" })).not.toHaveProperty("openExternalRef");
    expect(releaseExternalRef({ status: "CLOSED", openExternalRef: "x" })).toEqual({ status: "CLOSED", openExternalRef: null });
  });

  it("passes non-object data through and handles createMany lists", () => {
    expect(releaseExternalRef(undefined)).toBeUndefined();
    expect(releaseExternalRefMany([{ status: "CLOSED" }, { status: "NEW" }])).toEqual([{ status: "CLOSED", openExternalRef: null }, { status: "NEW" }]);
    expect(releaseExternalRefMany({ status: "CANCELLED" })).toEqual({ status: "CANCELLED", openExternalRef: null });
  });
});

describe("isOpenExternalRefConflict", () => {
  it("recognises P2002 on openExternalRef in Prisma's target shapes", () => {
    expect(isOpenExternalRefConflict({ code: "P2002", meta: { target: ["openExternalRef"] } })).toBe(true);
    expect(isOpenExternalRefConflict({ code: "P2002", meta: { target: "Ticket_openExternalRef_key" } })).toBe(true);
  });

  it("ignores other unique violations and other errors", () => {
    expect(isOpenExternalRefConflict({ code: "P2002", meta: { target: ["importRef"] } })).toBe(false);
    expect(isOpenExternalRefConflict({ code: "P2025", meta: { target: ["openExternalRef"] } })).toBe(false);
    expect(isOpenExternalRefConflict(new Error("boom"))).toBe(false);
    expect(isOpenExternalRefConflict(null)).toBe(false);
  });
});

describe("ticket create body", () => {
  const parse = (body: unknown) => {
    const n = camelizeBody(body);
    if ("conflict" in n) throw new Error("conflict");
    return ticketCreateSchema.safeParse(n.body);
  };

  it("takes external_ref and on_duplicate in snake_case, defaulting to return", () => {
    const r = parse({ title: "Disk full", external_ref: "zabbix:event:1" });
    expect(r.success && r.data.externalRef).toBe("zabbix:event:1");
    expect(r.success && r.data.onDuplicate).toBe("return");
    const c = parse({ title: "Disk full", externalRef: "zabbix:event:1", on_duplicate: "comment" });
    expect(c.success && c.data.onDuplicate).toBe("comment");
  });

  it("rejects an invalid ref or on_duplicate value", () => {
    expect(parse({ title: "Disk full", external_ref: "a/b" }).success).toBe(false);
    expect(parse({ title: "Disk full", external_ref: "" }).success).toBe(false);
    expect(parse({ title: "Disk full", external_ref: "x", on_duplicate: "reopen" }).success).toBe(false);
  });

  it("stays valid without a ref", () => {
    const r = parse({ title: "Printer jam" });
    expect(r.success && r.data.externalRef).toBeUndefined();
  });
});

describe("resolve-by-ref body", () => {
  it("is optional, internal by default and validates the resolution code", () => {
    expect(ticketResolveSchema.parse({})).toEqual({ internal: true });
    expect(ticketResolveSchema.parse({ resolutionNote: " recovered ", resolutionCode: "FIXED", internal: false }))
      .toEqual({ resolutionNote: "recovered", resolutionCode: "FIXED", internal: false });
    expect(ticketResolveSchema.safeParse({ resolutionCode: "MAGIC" }).success).toBe(false);
    expect(ticketResolveSchema.safeParse({ status: "CLOSED" }).success).toBe(false);
  });
});

describe("duplicateCommentText", () => {
  it("uses the description, falls back to the title, and caps the length", () => {
    expect(duplicateCommentText({ title: "Disk full", description: "  95% on /var  " })).toBe("95% on /var");
    expect(duplicateCommentText({ title: "Disk full", description: "" })).toBe("Disk full");
    expect(duplicateCommentText({ title: "t", description: "x".repeat(60_000) })).toHaveLength(50_000);
  });
});
