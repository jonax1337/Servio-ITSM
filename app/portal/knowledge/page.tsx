import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { LinkButton } from "@/components/link-button";
import { NoResultsArt } from "@/components/portal/illustrations";
import { KnowledgeBrowser, type KbCard } from "@/components/portal/knowledge-browser";
import type { SearchParams } from "@/lib/query";
import { getParam } from "@/lib/query";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("portal");
  return { title: t("kbTitle") };
}
export const dynamic = "force-dynamic";

export default async function PortalKnowledge({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const q = getParam(await searchParams, "q");
  const articles = await db.article.findMany({
    // End users only ever see published, public-facing articles.
    where: { status: "PUBLISHED", visibility: "PUBLIC" },
    orderBy: { views: "desc" },
    include: { category: true },
  });
  const t = await getT("portal");

  const cards: KbCard[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt ?? "",
    category: a.category?.name ?? t("general"),
    views: a.views,
  }));

  return (
    <div className="grid gap-8">
      <header className="flex items-start gap-4">
        <span className="hidden size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary sm:grid">
          <BookOpen className="size-6" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("kbTitle")}
          </h1>
          <p className="mt-1 max-w-xl text-muted-foreground">
            {t("kbDescription")}
          </p>
        </div>
      </header>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-14 text-center">
          <NoResultsArt className="h-28 w-28" />
          <p className="font-medium">{t("noArticlesYet")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("noArticlesText")}
          </p>
          <LinkButton href="/portal/new" size="sm" variant="outline" className="mt-1">
            {t("askServiceDesk")}
          </LinkButton>
        </div>
      ) : (
        <KnowledgeBrowser items={cards} initialQuery={q ?? ""} />
      )}
    </div>
  );
}
