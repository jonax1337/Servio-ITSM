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
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4 text-muted-foreground" />
          Related articles · {linked.length}
          <span className="ml-auto flex items-center gap-1.5">
            {actions}
            <LinkPicker
              action={linkArticle}
              triggerLabel="Link"
              title="Link an article"
              description="Published articles and your own drafts."
              hidden={{ entityType, entityId }}
              valueName="articleId"
              options={options}
              placeholder="Choose an article"
              searchPlaceholder="Search articles…"
              emptyText="No articles available to link."
              successMessage="Article linked"
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No articles linked yet.</p>
        ) : (
          linked.map((a) => (
            <div key={a.linkId} className="flex items-center gap-2">
              <Link href={`/knowledge/${a.slug}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                {a.title}
              </Link>
              <StatusBadge map={ARTICLE_STATUS_META} value={a.status} />
              <UnlinkButton action={unlinkArticle} fields={{ id: a.linkId }} successMessage="Article unlinked" />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
