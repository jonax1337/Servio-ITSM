import { Info } from "lucide-react";
import type { InsightConfig } from "@/lib/ai-insights-rules";
import { getT } from "@/lib/i18n/server";

type InsightsExplainerProps = {
  config: InsightConfig;
  /** False when an admin switched detection off: no new insights will appear. */
  enabled: boolean;
};

/** What an insight is and when Sable raises one, using the thresholds currently in effect. */
export async function InsightsExplainer({ config, enabled }: InsightsExplainerProps) {
  const t = await getT("assistant");
  return (
    <section className="grid gap-3 rounded-xl border bg-card/50 p-4 text-sm" aria-labelledby="insights-explainer-title">
      <h2 id="insights-explainer-title" className="flex items-center gap-2 font-medium">
        <Info className="size-4 text-muted-foreground" />
        {t("explainer.title")}
      </h2>
      <p className="text-muted-foreground">{t("explainer.intro")}</p>
      {enabled ? null : (
        <p className="font-medium text-foreground">{t("explainer.off")}</p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="font-medium">{t("explainer.cluster")}</dt>
          <dd className="text-muted-foreground">
            {t("explainer.clusterBody", { min: config.clusterMinTickets, hours: config.clusterWindowHours })}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="font-medium">{t("explainer.kbGap")}</dt>
          <dd className="text-muted-foreground">
            {t("explainer.kbGapBody", { min: config.kbGapMinTickets, days: config.kbGapWindowDays })}
          </dd>
        </div>
      </dl>
    </section>
  );
}
