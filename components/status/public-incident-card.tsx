import { format } from "date-fns";
import { ChevronDown, LifeBuoy } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { AffectsMeButton } from "@/components/status/affects-me-button";
import { IncidentTimeline } from "@/components/status/incident-timeline";
import { isActiveIncidentState } from "@/lib/status-rules";
import type { PublicIncident } from "@/lib/status-incidents";
import { STATUS_INCIDENT_IMPACT_META, STATUS_INCIDENT_STATE_META } from "@/lib/constants";

/**
 * How much of the timeline a card shows: everything (`full`), only the latest
 * update (`compact`, for the new-request page), or everything behind a toggle
 * (`history`, for resolved incidents).
 */
type CardVariant = "full" | "compact" | "history";

const dateTime = (date: Date) => format(date, "MMM d, HH:mm");

function CardTimeline({ incident, variant }: { incident: PublicIncident; variant: CardVariant }) {
  if (incident.updates.length === 0) return null;
  if (variant === "compact") return <IncidentTimeline updates={incident.updates.slice(0, 1)} />;
  if (variant === "full") return <IncidentTimeline updates={incident.updates} />;
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        {incident.updates.length === 1 ? "Show update" : `Show all ${incident.updates.length} updates`}
      </summary>
      <div className="mt-3">
        <IncidentTimeline updates={incident.updates} />
      </div>
    </details>
  );
}

/** A public incident as portal users see it. */
export function PublicIncidentCard({ incident, variant = "full" }: { incident: PublicIncident; variant?: CardVariant }) {
  return (
    <article className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge map={STATUS_INCIDENT_STATE_META} value={incident.state} />
          <StatusBadge map={STATUS_INCIDENT_IMPACT_META} value={incident.impact} dot={false} />
          <span className="text-xs text-muted-foreground">
            Started {dateTime(incident.startedAt)}
            {incident.resolvedAt ? ` · Resolved ${dateTime(incident.resolvedAt)}` : ""}
          </span>
        </div>
        <h3 className="font-display text-lg font-semibold tracking-tight">{incident.title}</h3>
        {incident.summary ? <p className="text-sm text-muted-foreground">{incident.summary}</p> : null}
        {incident.services.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <LifeBuoy className="size-3.5" />
            Affects {incident.services.join(", ")}
          </p>
        ) : null}
      </header>

      <CardTimeline incident={incident} variant={variant} />

      {incident.joined && isActiveIncidentState(incident.state) ? (
        <p className="text-sm text-muted-foreground">You told us this affects you. New updates appear on this page.</p>
      ) : incident.canJoin ? (
        <div className="grid gap-1.5">
          <div>
            <AffectsMeButton incidentId={incident.id} />
          </div>
          <p className="text-xs text-muted-foreground">No need to open a new request. We tell the team working on it.</p>
        </div>
      ) : null}
    </article>
  );
}
