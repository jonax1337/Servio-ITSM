import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { canActOnTicket } from "@/lib/authz";
import { ticketRef } from "@/lib/constants";
import { getParam, type SearchParams } from "@/lib/query";
import { articleDraftFromTicket } from "@/lib/article-drafts";
import { PageHeader, PageBody } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ArticleEditor } from "@/components/knowledge/article-editor";
import { createArticle } from "@/lib/actions/knowledge";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("knowledge");
  return { title: t("newTitle") };
}
export const dynamic = "force-dynamic";

/**
 * The ticket named by `?fromTicket=`: what the editor is prefilled from, and what saving links the article to.
 * A ticket the agent can't act on is never read into the draft; `unavailable` says the link named one.
 */
async function loadSourceTicket(sp: SearchParams, me: { id: string; role: string }) {
  const requested = getParam(sp, "fromTicket");
  const id = Number(requested);
  if (!requested) return null;
  if (!Number.isInteger(id) || id <= 0) return { unavailable: true as const };
  const ticket = await db.ticket.findUnique({
    where: { id },
    select: {
      id: true, prefix: true, title: true, description: true, descriptionHtml: true, resolutionNote: true,
      assigneeId: true, groupId: true,
    },
  });
  if (!ticket || !(await canActOnTicket(me, ticket))) return { unavailable: true as const };
  return {
    unavailable: false as const,
    draft: articleDraftFromTicket(ticket),
    link: { id: ticket.id, ref: ticketRef(ticket.id, ticket.prefix) },
  };
}

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireRole("AGENT");
  const t = await getT("knowledge");
  const [categories, source] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    searchParams.then((sp) => loadSourceTicket(sp, me)),
  ]);

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title={t("newTitle")}
        description={t("newDescription")}
      />
      <PageBody>
        {source?.unavailable ? (
          <Alert className="mx-auto mb-4 max-w-5xl">
            <AlertDescription>{t("sourceUnavailable")}</AlertDescription>
          </Alert>
        ) : null}
        <Card className="mx-auto max-w-5xl">
          <CardContent>
            <ArticleEditor
              action={createArticle}
              categories={categories}
              submitLabel={t("createArticle")}
              defaults={source && !source.unavailable ? { title: source.draft.title, body: source.draft.bodyHtml, bodyFormat: "html" } : undefined}
              sourceTicket={source && !source.unavailable ? source.link : undefined}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
