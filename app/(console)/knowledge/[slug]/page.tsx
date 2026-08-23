import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Eye, FolderOpen, User as UserIcon, Pencil, History, Send, CheckCircle2, Undo2, Archive, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { renderMarkdown, sanitizeCommentHtml } from "@/lib/markdown";
import { changeArticleStatus, deleteArticle } from "@/lib/actions/knowledge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { ARTICLE_STATUS_META, ARTICLE_VISIBILITY_META } from "@/lib/constants";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await db.article.findUnique({ where: { slug }, select: { title: true } });
  return { title: article ? article.title : "Article" };
}

function StatusButton({ id, to, children, variant = "outline" }: {
  id: string;
  to: string;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive";
}) {
  return (
    <form action={changeArticleStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <Button type="submit" size="sm" variant={variant}>{children}</Button>
    </form>
  );
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireRole("AGENT");
  const { slug } = await params;

  const article = await db.article.findUnique({
    where: { slug },
    include: { category: true, author: true, _count: { select: { revisions: true } } },
  });
  if (!article) notFound();

  const authorName = article.author?.name ?? article.author?.email ?? null;
  const html =
    article.bodyFormat === "html"
      ? sanitizeCommentHtml(article.body)
      : renderMarkdown(article.body, article.bodyFormat);
  const s = article.status;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <LinkButton href="/knowledge" variant="ghost" size="icon-sm" aria-label="Back to knowledge base">
          <ArrowLeft className="size-4" />
        </LinkButton>
        <StatusBadge map={ARTICLE_VISIBILITY_META} value={article.visibility} />
        <StatusBadge map={ARTICLE_STATUS_META} value={article.status} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Lifecycle transitions */}
          {(s === "DRAFT" || s === "RETIRED") ? (
            <StatusButton id={article.id} to="REVIEW"><Send className="size-3.5" /> Submit for review</StatusButton>
          ) : null}
          {(s === "REVIEW") ? (
            <StatusButton id={article.id} to="DRAFT"><Undo2 className="size-3.5" /> Back to draft</StatusButton>
          ) : null}
          {(s === "DRAFT" || s === "REVIEW" || s === "RETIRED") ? (
            <StatusButton id={article.id} to="PUBLISHED" variant="default"><CheckCircle2 className="size-3.5" /> Publish</StatusButton>
          ) : null}
          {(s === "PUBLISHED") ? (
            <>
              <StatusButton id={article.id} to="DRAFT"><Undo2 className="size-3.5" /> Unpublish</StatusButton>
              <StatusButton id={article.id} to="RETIRED"><Archive className="size-3.5" /> Retire</StatusButton>
            </>
          ) : null}

          <LinkButton href={`/knowledge/${article.slug}/edit`} variant="outline" size="sm">
            <Pencil className="size-3.5" /> Edit
          </LinkButton>
          <ConfirmButton
            action={deleteArticle}
            fields={{ id: article.id }}
            title="Delete article?"
            description={`"${article.title}" and its revision history will be permanently deleted.`}
            triggerLabel="Delete article"
          >
            <Trash2 className="size-3.5" />
          </ConfirmButton>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {article.visibility === "INTERNAL" ? (
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            Internal article — not visible to end users in the portal.
          </p>
        ) : null}

        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {article.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {authorName ? (
            <span className="inline-flex items-center gap-1.5"><UserIcon className="size-3.5" /> {authorName}</span>
          ) : null}
          {article.category ? (
            <span className="inline-flex items-center gap-1.5"><FolderOpen className="size-3.5" /> {article.category.name}</span>
          ) : null}
          <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" /> {article.views} views</span>
          <span className="inline-flex items-center gap-1.5"><History className="size-3.5" /> rev {article._count.revisions}</span>
          <span>·</span>
          <span>updated {format(article.updatedAt, "PP")}</span>
        </div>

        <div className="mt-6 rounded-xl border bg-card p-5 sm:p-6">
          <article
            className="prose prose-sm prose-invert max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
