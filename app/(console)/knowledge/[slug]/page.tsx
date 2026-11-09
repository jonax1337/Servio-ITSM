import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Eye, FolderOpen, User as UserIcon, Pencil, History, Send, CheckCircle2, Undo2, Archive, Trash2, Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { hasRole, requireRole } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { renderMarkdown, sanitizeCommentHtml } from "@/lib/markdown";
import { deleteArticle } from "@/lib/actions/knowledge";
import { ArticleStatusButton } from "@/components/knowledge/article-status-button";
import { getArticleLinkedRecords } from "@/lib/data/related-articles";
import { ConfirmButton } from "@/components/confirm-dialog";
import { ArticleHistoryDialog, type ArticleRevisionRow } from "@/components/knowledge/article-history-dialog";
import { ARTICLE_STATUS_META, ARTICLE_VISIBILITY_META } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { slug } = await params;
  const article = await db.article.findUnique({ where: { slug }, select: { title: true } });
  const t = await getT("knowledge");
  return { title: article ? article.title : t("article") };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const me = await requireRole("AGENT");
  const { slug } = await params;

  const article = await db.article.findUnique({
    where: { slug },
    include: {
      category: true,
      author: true,
      _count: { select: { revisions: true } },
      revisions: {
        orderBy: { version: "desc" },
        include: { editor: { select: { name: true, email: true, image: true } } },
      },
    },
  });
  if (!article) notFound();
  const [t, tc, f] = await Promise.all([getT("knowledge"), getT("common"), getFormatter()]);
  const linkedRecords = await getArticleLinkedRecords(article.id);

  const authorName = article.author?.name ?? article.author?.email ?? null;
  const canPublish = hasRole(me.role, "MANAGER") && article.authorId !== me.id;
  const html =
    article.bodyFormat === "html"
      ? sanitizeCommentHtml(article.body)
      : renderMarkdown(article.body, article.bodyFormat);
  const s = article.status;
  const revisionRows: ArticleRevisionRow[] = article.revisions.map((r) => ({
    id: r.id,
    version: r.version,
    title: r.title,
    excerpt: r.excerpt,
    html: sanitizeCommentHtml(r.body),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    editor: r.editor,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <LinkButton href="/knowledge" variant="ghost" size="icon-sm" aria-label={t("backToKnowledge")}>
          <ArrowLeft className="size-4" />
        </LinkButton>
        <StatusBadge map={ARTICLE_VISIBILITY_META} value={article.visibility} />
        <StatusBadge map={ARTICLE_STATUS_META} value={article.status} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Lifecycle transitions */}
          {(s === "DRAFT" || s === "RETIRED") ? (
            <ArticleStatusButton id={article.id} to="REVIEW" successMessage={t("submittedForReview")}><Send className="size-3.5" /> {t("submitForReview")}</ArticleStatusButton>
          ) : null}
          {(s === "REVIEW" || s === "RETIRED") ? (
            <ArticleStatusButton id={article.id} to="DRAFT" successMessage={t("movedBackToDraft")}><Undo2 className="size-3.5" /> {s === "RETIRED" ? t("reviseAsDraft") : t("backToDraft")}</ArticleStatusButton>
          ) : null}
          {/* Publishing is an editorial sign-off: MANAGER+ and never the author (enforced in setArticleStatus). */}
          {(s === "DRAFT" || s === "REVIEW" || s === "RETIRED") && canPublish ? (
            <ArticleStatusButton id={article.id} to="PUBLISHED" variant="default" successMessage={t("published")}><CheckCircle2 className="size-3.5" /> {t("publish")}</ArticleStatusButton>
          ) : null}
          {(s === "PUBLISHED") ? (
            <>
              <ArticleStatusButton id={article.id} to="DRAFT" successMessage={t("unpublished")}><Undo2 className="size-3.5" /> {t("unpublish")}</ArticleStatusButton>
              <ArticleStatusButton id={article.id} to="RETIRED" successMessage={t("retired")}><Archive className="size-3.5" /> {t("retire")}</ArticleStatusButton>
            </>
          ) : null}

          <ArticleHistoryDialog articleId={article.id} revisions={revisionRows} />

          <LinkButton href={`/knowledge/${article.slug}/edit`} variant="outline" size="sm">
            <Pencil className="size-3.5" /> {tc("edit")}
          </LinkButton>
          <ConfirmButton
            action={deleteArticle}
            fields={{ id: article.id }}
            title={t("deleteTitle")}
            description={t("deleteDescription", { title: article.title })}
            triggerLabel={t("deleteArticle")}
          >
            <Trash2 className="size-3.5" />
          </ConfirmButton>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {article.visibility === "INTERNAL" ? (
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("internalNotice")}
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
          <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" /> {t("views", { count: article.views })}</span>
          <span className="inline-flex items-center gap-1.5"><History className="size-3.5" /> {t("revision", { count: article._count.revisions })}</span>
          <span>·</span>
          <span>{t("updatedOn", { date: f.date(article.updatedAt) })}</span>
        </div>

        <div className="mt-6 rounded-xl border bg-card p-5 sm:p-6">
          <article
            className="prose prose-sm prose-invert max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>

        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-muted-foreground" />
            {t("linkedRecords", { count: linkedRecords.length })}
          </h2>
          {linkedRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noLinkedRecords")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {linkedRecords.map((r) => (
                <Link
                  key={r.key}
                  href={r.href}
                  className="group flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/40"
                >
                  <span className="w-[76px] shrink-0 font-mono text-xs text-muted-foreground">{r.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">{r.title}</span>
                  <ToneBadge meta={r.statusMeta} dot />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
