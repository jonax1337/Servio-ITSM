import Link from "next/link";
import { BookOpen, Eye, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getParam, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { ListToolbar } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import {
  ARTICLE_STATUSES, ARTICLE_STATUS_META, ARTICLE_VISIBILITIES, ARTICLE_VISIBILITY_META,
} from "@/lib/constants";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("knowledge");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [t, tc, te, f] = await Promise.all([getT("knowledge"), getT("common"), getEnumT(), getFormatter()]);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const visibility = getParam(sp, "visibility");

  // Console is agent-only: show every status, not just published.
  const where: Prisma.ArticleWhereInput = {};
  if (q) where.title = { contains: q };
  if (status && ARTICLE_STATUSES.includes(status as (typeof ARTICLE_STATUSES)[number])) where.status = status;
  if (visibility && ARTICLE_VISIBILITIES.includes(visibility as (typeof ARTICLE_VISIBILITIES)[number])) where.visibility = visibility;

  const articles = await db.article.findMany({
    where,
    include: { category: true, author: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    <>
      <PageHeader
        icon={BookOpen}
        title={t("title")}
        description={t("description")}
      >
        <LinkButton href="/knowledge/new">
          <Plus className="size-4" /> {t("newArticle")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar
          searchPlaceholder={t("searchPlaceholder")}
          filters={[
            { key: "status", label: tc("status"), options: te.options(ARTICLE_STATUS_META, ARTICLE_STATUSES) },
            { key: "visibility", label: t("visibility"), options: te.options(ARTICLE_VISIBILITY_META, ARTICLE_VISIBILITIES) },
          ]}
        />

        {articles.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="divide-y">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/knowledge/${a.slug}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{a.category?.name ?? t("generalCategory")}</span>
                      <span>·</span>
                      <span>{a.author?.name ?? a.author?.email ?? tc("unknown")}</span>
                      <span>·</span>
                      <span>{t("updatedAgo", { when: f.relative(a.updatedAt) })}</span>
                    </div>
                  </div>
                  <StatusBadge map={ARTICLE_VISIBILITY_META} value={a.visibility} />
                  <StatusBadge map={ARTICLE_STATUS_META} value={a.status} />
                  <span className="hidden w-14 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground sm:flex">
                    <Eye className="size-3.5" /> {a.views}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
