import Link from "next/link";
import { Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getBoolSetting } from "@/lib/settings";
import { loadInsightConfig } from "@/lib/ai-insights";
import { AI_INSIGHT_KIND_META, AI_INSIGHT_STATUS_META, problemRef } from "@/lib/constants";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { InsightCard } from "@/components/ai/insights/insight-card";
import { InsightsExplainer } from "@/components/ai/insights/insights-explainer";
import { getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("insights");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

const MAX_OPEN_INSIGHTS = 100;
const MAX_RECENT_INSIGHTS = 10;

const TICKET_SELECT = { select: { ticket: { select: { id: true, prefix: true, title: true, status: true } } } } as const;

type InsightKind = "CLUSTER" | "KB_GAP";
const SECTIONS: { kind: InsightKind; heading: "incidentClusters" | "knowledgeGaps" }[] = [
  { kind: "CLUSTER", heading: "incidentClusters" },
  { kind: "KB_GAP", heading: "knowledgeGaps" },
];

export default async function InsightsPage() {
  await requireRole("AGENT");
  const [t, f] = await Promise.all([getT("insights"), getFormatter()]);

  const [open, recent, config, detectionEnabled] = await Promise.all([
    db.aiInsight.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: MAX_OPEN_INSIGHTS,
      include: { tickets: TICKET_SELECT },
    }),
    db.aiInsight.findMany({
      where: { status: { not: "OPEN" } },
      orderBy: { updatedAt: "desc" },
      take: MAX_RECENT_INSIGHTS,
      include: { article: { select: { slug: true, title: true } } },
    }),
    loadInsightConfig(),
    getBoolSetting("INSIGHTS_ENABLED", true),
  ]);

  const cards = open.map((insight) => ({ ...insight, tickets: insight.tickets.map((row) => row.ticket) }));

  return (
    <>
      <PageHeader
        icon={Lightbulb}
        title={t("title")}
        description={t("description")}
      />

      <PageBody className="grid gap-6">
        {cards.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          SECTIONS.map(({ kind, heading }) => {
            const ofKind = cards.filter((card) => card.kind === kind);
            if (ofKind.length === 0) return null;
            return (
              <section key={kind} className="grid gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {t(heading)} <span className="tabular-nums">({ofKind.length})</span>
                </h2>
                {ofKind.map((card) => (
                  <InsightCard key={card.id} insight={card} />
                ))}
              </section>
            );
          })
        )}

        {recent.length > 0 ? (
          <section className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("recentlyHandled")}</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {recent.map((insight) => (
                <li key={insight.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <StatusBadge map={AI_INSIGHT_STATUS_META} value={insight.status} />
                  <StatusBadge map={AI_INSIGHT_KIND_META} value={insight.kind} />
                  <span className="min-w-[12rem] flex-1 line-clamp-2">{insight.title}</span>
                  {insight.problemId ? (
                    <Link href={`/problems/${insight.problemId}`} className="text-primary hover:underline">
                      {problemRef(insight.problemId)}
                    </Link>
                  ) : null}
                  {insight.article ? (
                    <Link href={`/knowledge/${insight.article.slug}`} className="text-primary hover:underline">
                      {insight.article.title}
                    </Link>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {f.relative(insight.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <InsightsExplainer config={config} enabled={detectionEnabled} />
      </PageBody>
    </>
  );
}
