/** The knowledge article an agent writes from a resolved ticket: what was reported, then how it was resolved. */
import { renderMarkdown } from "@/lib/markdown";

/** Longest article title the editor accepts. */
const MAX_ARTICLE_TITLE_CHARS = 160;

type ArticleSourceTicket = {
  title: string;
  description: string;
  descriptionHtml: string | null;
  resolutionNote: string | null;
};

/** Title and HTML body to prefill a knowledge article written from a ticket. */
export function articleDraftFromTicket(ticket: ArticleSourceTicket): { title: string; bodyHtml: string } {
  const problem = ticket.descriptionHtml?.trim() || renderMarkdown(ticket.description.trim(), "plain");
  const sections = [`<h2>Problem</h2>${problem}`];
  const resolution = ticket.resolutionNote?.trim();
  if (resolution) sections.push(`<h2>Resolution</h2>${renderMarkdown(resolution, "plain")}`);
  return { title: ticket.title.slice(0, MAX_ARTICLE_TITLE_CHARS), bodyHtml: sections.join("") };
}
