import { Info } from "lucide-react";
import type { InsightConfig } from "@/lib/ai-insights-rules";

type InsightsExplainerProps = {
  config: InsightConfig;
  /** False when an admin switched detection off: no new insights will appear. */
  enabled: boolean;
};

/** What an insight is and when Sable raises one, using the thresholds currently in effect. */
export function InsightsExplainer({ config, enabled }: InsightsExplainerProps) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card/50 p-4 text-sm" aria-labelledby="insights-explainer-title">
      <h2 id="insights-explainer-title" className="flex items-center gap-2 font-medium">
        <Info className="size-4 text-muted-foreground" />
        How Sable finds insights
      </h2>
      <p className="text-muted-foreground">
        Sable regularly compares ticket texts on this server (no AI call needed) and raises an insight when it spots a
        pattern that deserves a follow-up. Each pattern is raised once; dismissed insights do not come back.
      </p>
      {enabled ? null : (
        <p className="font-medium text-foreground">Detection is switched off, so no new insights are raised.</p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="font-medium">Incident cluster</dt>
          <dd className="text-muted-foreground">
            {config.clusterMinTickets} or more incidents opened within {config.clusterWindowHours} hours that read alike
            (same wording, category or service) and are not linked to a problem yet. Create a problem to track the root
            cause and link all of them in one step.
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="font-medium">Knowledge gap</dt>
          <dd className="text-muted-foreground">
            {config.kbGapMinTickets} or more tickets resolved in the last {config.kbGapWindowDays} days with a documented
            fix (fixed or workaround) that reads alike and has no knowledge article. Draft an article from those
            resolutions.
          </dd>
        </div>
      </dl>
    </section>
  );
}
