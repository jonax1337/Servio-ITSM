"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import { linkArticle, unlinkArticle } from "@/lib/actions/article-links";
import { ARTICLE_STATUS_META, type ArticleLinkEntityType } from "@/lib/constants";
import type { ArticleOption, LinkedArticle } from "@/lib/data/related-articles";
import { useT } from "@/lib/i18n/client";

/** Knowledge articles attached to a ticket, problem or change, with a picker to attach more. */
export function RelatedArticles({
  entityType,
  entityId,
  linked,
  options,
  actions,
  className,
}: {
  entityType: ArticleLinkEntityType;
  entityId: number;
  linked: LinkedArticle[];
  options: ArticleOption[];
  /** Extra header actions shown beside the link picker. */
  actions?: ReactNode;
  className?: string;
}) {
  const t = useT("tickets");
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4 text-muted-foreground" />
          {t("related.title", { count: linked.length })}
          <span className="ml-auto flex items-center gap-1.5">
            {actions}
            <LinkPicker
              action={linkArticle}
              triggerLabel={t("related.link")}
              title={t("related.linkTitle")}
              description={t("related.linkDescription")}
              hidden={{ entityType, entityId }}
              valueName="articleId"
              options={options}
              placeholder={t("related.choose")}
              searchPlaceholder={t("related.search")}
              emptyText={t("related.noOptions")}
              successMessage={t("related.linked")}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("related.none")}</p>
        ) : (
          linked.map((a) => (
            <div key={a.linkId} className="flex items-center gap-2">
              <Link href={`/knowledge/${a.slug}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                {a.title}
              </Link>
              <StatusBadge map={ARTICLE_STATUS_META} value={a.status} />
              <UnlinkButton action={unlinkArticle} fields={{ id: a.linkId }} successMessage={t("related.unlinked")} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
