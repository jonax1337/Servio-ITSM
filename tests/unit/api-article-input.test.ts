import { describe, expect, it } from "vitest";
import {
  articleBodyHtml,
  articleCreateSchema,
  articlePatchSchema,
  articleUpsertSchema,
  changedArticleFields,
  statusColumns,
  type ArticleFields,
} from "@/lib/api-article-input";
import { refusalStatus } from "@/lib/api-itsm-input";

const stored: ArticleFields = {
  title: "Set up the VPN",
  excerpt: null,
  body: "<p>Install the client.</p>",
  visibility: "PUBLIC",
  categoryId: "cat-1",
  status: "PUBLISHED",
};

describe("article bodies", () => {
  it("accept markdown by default and store sanitised HTML", () => {
    expect(articleBodyHtml("**Install** the client.")).toContain("<strong>Install</strong>");
  });

  it("strip scripts from HTML bodies", () => {
    expect(articleBodyHtml('<p>Hi</p><script>alert(1)</script>', "html")).toBe("<p>Hi</p>");
  });

  it("refuse a body with no readable text", () => {
    expect(articleBodyHtml("<script>alert(1)</script>", "html")).toBeNull();
  });
});

describe("article schemas", () => {
  it("create takes an import_ref with the external-ref charset", () => {
    expect(articleCreateSchema.safeParse({ title: "VPN", body: "x", import_ref: "faq:vpn" }).success).toBe(true);
    expect(articleCreateSchema.safeParse({ title: "VPN", body: "x", import_ref: "faq/vpn" }).success).toBe(false);
  });

  it("patch refuses an empty body of changes and a body_format without a body", () => {
    expect(articlePatchSchema.safeParse({}).success).toBe(false);
    expect(articlePatchSchema.safeParse({ body_format: "html" }).success).toBe(false);
    expect(articlePatchSchema.safeParse({ visibility: "PUBLIC" }).success).toBe(true);
  });

  it("upsert needs the full content and is strict", () => {
    expect(articleUpsertSchema.safeParse({ title: "VPN" }).success).toBe(false);
    expect(articleUpsertSchema.safeParse({ title: "VPN", body: "x", slug: "vpn" }).success).toBe(false);
  });
});

describe("changedArticleFields", () => {
  it("is empty when the same content is sent again", () => {
    expect(changedArticleFields(stored, { title: stored.title, body: stored.body, visibility: "PUBLIC" })).toEqual([]);
  });

  it("lists only the fields that differ and ignores those not sent", () => {
    expect(changedArticleFields(stored, { title: "Set up the VPN client", body: stored.body })).toEqual(["title"]);
  });

  it("treats clearing the category as a change", () => {
    expect(changedArticleFields(stored, { title: stored.title, body: stored.body, categoryId: null })).toEqual(["categoryId"]);
  });
});

describe("statusColumns", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("publishing stamps the approval and keeps the first publish time", () => {
    const first = new Date("2026-01-01T00:00:00Z");
    expect(statusColumns("PUBLISHED", { publishedAt: first }, "u1", now)).toEqual({
      status: "PUBLISHED", published: true, publishedAt: first, approvedById: "u1", approvedAt: now,
    });
  });

  it("any other status unpublishes", () => {
    expect(statusColumns("RETIRED", { publishedAt: now }, "u1", now)).toEqual({ status: "RETIRED", published: false });
  });
});

describe("article refusals", () => {
  it("map the publishing rules to 403", () => {
    expect(refusalStatus("Publishing an article requires manager approval.")).toBe(403);
    expect(refusalStatus("An article must be published by a different reviewer than its author.")).toBe(403);
  });
});
