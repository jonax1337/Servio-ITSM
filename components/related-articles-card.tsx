import type { ReactNode } from "react";
import { getSessionUser, isAgent, type Role } from "@/lib/session";
import { getRelatedArticles } from "@/lib/data/related-articles";
import { RelatedArticles } from "@/components/related-articles";
import type { ArticleLinkEntityType } from "@/lib/constants";

/** Server wrapper that loads the linked articles for a record and renders {@link RelatedArticles}. */
export async function RelatedArticlesCard({
  entityType,
  entityId,
  actions,
  className,
}: {
  entityType: ArticleLinkEntityType;
  entityId: number;
  actions?: ReactNode;
  className?: string;
}) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return null;
  const { linked, options } = await getRelatedArticles(entityType, entityId, me.id);
  return <RelatedArticles entityType={entityType} entityId={entityId} linked={linked} options={options} actions={actions} className={className} />;
}
