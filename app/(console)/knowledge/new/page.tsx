import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { canActOnTicket } from "@/lib/authz";
import { ticketRef } from "@/lib/constants";
import { getParam, type SearchParams } from "@/lib/query";
import { articleDraftFromTicket } from "@/lib/article-drafts";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { createArticle } from "@/lib/actions/knowledge";

export const metadata: Metadata = { title: "New article" };
export const dynamic = "force-dynamic";

/** The ticket named by `?fromTicket=`: what the editor is prefilled from, and what saving links the article to. */
async function loadSourceTicket(sp: SearchParams, me: { id: string; role: string }) {
  const id = Number(getParam(sp, "fromTicket"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const ticket = await db.ticket.findUnique({
    where: { id },
    select: {
      id: true, prefix: true, title: true, description: true, descriptionHtml: true, resolutionNote: true,
      assigneeId: true, groupId: true,
    },
  });
  if (!ticket) return null;
  return {
    draft: articleDraftFromTicket(ticket),
    link: (await canActOnTicket(me, ticket)) ? { id: ticket.id, ref: ticketRef(ticket.id, ticket.prefix) } : undefined,
  };
}

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireRole("AGENT");
  const [categories, source] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    searchParams.then((sp) => loadSourceTicket(sp, me)),
  ]);

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title="New article"
        description="Draft a knowledge base article. It starts as a draft until you publish it."
      />
      <PageBody>
        <Card className="mx-auto max-w-5xl">
          <CardContent>
            <ArticleEditor
              action={createArticle}
              categories={categories}
              submitLabel="Create article"
              defaults={source ? { title: source.draft.title, body: source.draft.bodyHtml, bodyFormat: "html" } : undefined}
              sourceTicket={source?.link}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
