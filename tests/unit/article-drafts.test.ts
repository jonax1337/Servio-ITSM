import { describe, expect, it } from "vitest";
import { articleDraftFromTicket } from "@/lib/article-drafts";

describe("articleDraftFromTicket", () => {
  const resolved = { title: "Printer jams", description: "Paper jams <often>.", descriptionHtml: null, resolutionNote: "Replaced the pickup roller." };

  it("writes the report and the resolution as two sections", () => {
    const { title, bodyHtml } = articleDraftFromTicket(resolved);
    expect(title).toBe("Printer jams");
    expect(bodyHtml).toBe("<h2>Problem</h2>Paper jams &lt;often&gt;.<h2>Resolution</h2>Replaced the pickup roller.");
  });

  it("prefers the rich description when the ticket has one", () => {
    const { bodyHtml } = articleDraftFromTicket({ ...resolved, descriptionHtml: "<p>Paper <b>jams</b>.</p>" });
    expect(bodyHtml).toBe("<h2>Problem</h2><p>Paper <b>jams</b>.</p><h2>Resolution</h2>Replaced the pickup roller.");
  });

  it("leaves the resolution section out when there is no note", () => {
    expect(articleDraftFromTicket({ ...resolved, resolutionNote: "  " }).bodyHtml).toBe("<h2>Problem</h2>Paper jams &lt;often&gt;.");
  });

  it("keeps the title within the article limit", () => {
    expect(articleDraftFromTicket({ ...resolved, title: "t".repeat(400) }).title).toHaveLength(160);
  });
});
