import { describe, expect, it } from "vitest";
import { htmlToText, parseMentionIds, renderMarkdown, sanitizeCommentHtml } from "@/lib/markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown to HTML", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** text.");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders GitHub-flavoured tables", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<td>1</td>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```bash\necho hi\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("echo hi");
  });

  it("does not execute raw HTML script content", () => {
    const html = renderMarkdown('Hello\n\n<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
  });
});

describe("sanitizeCommentHtml", () => {
  it("keeps everyday formatting", () => {
    const html = sanitizeCommentHtml('<p>Hi <strong>there</strong></p>');
    expect(html).toContain("<strong>there</strong>");
  });

  it("strips event handlers", () => {
    const html = sanitizeCommentHtml('<p onclick="evil()">click</p>');
    expect(html).not.toContain("onclick");
  });

  it("strips script blocks", () => {
    const html = sanitizeCommentHtml("<div>ok</div><script>evil()</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("ok");
  });

  it("strips javascript: links", () => {
    const html = sanitizeCommentHtml('<a href="javascript:evil()">x</a>');
    expect(html?.toLowerCase()).not.toContain("javascript:");
  });
});

describe("htmlToText", () => {
  it("strips tags, keeps words and decodes entities", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toContain("Hello world");
    expect(htmlToText("a &amp; b &lt;c&gt;")).toContain("a & b <c>");
  });
  it("turns block boundaries into newlines", () => {
    const out = htmlToText("<p>one</p><p>two</p><ul><li>bullet</li></ul>");
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("- bullet");
    expect(out).toContain("\n");
  });
  // NB: htmlToText is a tag STRIPPER, not a sanitizer — callers feed it the
  // ALREADY-SANITIZED html (sanitizeCommentHtml / renderMarkdown above).
});

describe("parseMentionIds", () => {
  it("extracts data-mention-id chips", () => {
    const ids = parseMentionIds('<p>ping <span data-mention-id="u1">Sam</span> and <span data-mention-id="u2">Kim</span></p>');
    expect(ids).toEqual(["u1", "u2"]);
  });
  it("ignores forged attributes without ids", () => {
    expect(parseMentionIds("<p>plain text</p>")).toEqual([]);
  });
});
