import { ChevronDown, LifeBuoy } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { AffectsMeButton } from "@/components/status/affects-me-button";
import { IncidentTimeline } from "@/components/status/incident-timeline";
import { isActiveIncidentState } from "@/lib/status-rules";
import type { PublicIncident } from "@/lib/status-incidents";
import { STATUS_INCIDENT_IMPACT_META, STATUS_INCIDENT_STATE_META } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/format";

/**
 * How much of the timeline a card shows: everything (`full`), only the latest
 * update (`compact`, for the new-request page), or everything behind a toggle
 * (`history`, for resolved incidents).
 */
type CardVariant = "full" | "compact" | "history";

const dateTime = (date: Date, f: Formatter) => f.pattern(date, f.locale === "de" ? "d. MMM, HH:mm" : "MMM d, HH:mm");

async function CardTimeline({ incident, variant }: { incident: PublicIncident; variant: CardVariant }) {
  if (incident.updates.length === 0) return null;
  const t = await getT("status");
  if (variant === "compact") return <IncidentTimeline updates={incident.updates.slice(0, 1)} />;
  if (variant === "full") return <IncidentTimeline updates={incident.updates} />;
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        {incident.updates.length === 1 ? t("showUpdate") : t("showAllUpdates", { count: incident.updates.length })}
      </summary>
      <div className="mt-3">
        <IncidentTimeline updates={incident.updates} />
      </div>
    </details>
  );
}

/** A public incident as portal users see it. */
export async function PublicIncidentCard({ incident, variant = "full" }: { incident: PublicIncident; variant?: CardVariant }) {
  const [t, f] = await Promise.all([getT("status"), getFormatter()]);
  return (
    <article className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge map={STATUS_INCIDENT_STATE_META} value={incident.state} />
          <StatusBadge map={STATUS_INCIDENT_IMPACT_META} value={incident.impact} dot={false} />
          <span className="text-xs text-muted-foreground">
            {t("startedAt", { date: dateTime(incident.startedAt, f) })}
            {incident.resolvedAt ? t("resolvedAt", { date: dateTime(incident.resolvedAt, f) }) : ""}
          </span>
        </div>
        <h3 className="font-display text-lg font-semibold tracking-tight">{incident.title}</h3>
        {incident.summary ? <p className="text-sm text-muted-foreground">{incident.summary}</p> : null}
        {incident.services.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <LifeBuoy className="size-3.5" />
            {t("affects", { services: incident.services.join(", ") })}
          </p>
        ) : null}
      </header>

      <CardTimeline incident={incident} variant={variant} />

      {incident.joined && isActiveIncidentState(incident.state) ? (
        <p className="text-sm text-muted-foreground">{t("youAreAffected")}</p>
      ) : incident.canJoin ? (
        <div className="grid gap-1.5">
          <div>
            <AffectsMeButton incidentId={incident.id} />
          </div>
          <p className="text-xs text-muted-foreground">{t("noNewRequest")}</p>
        </div>
      ) : null}
    </article>
  );
}
