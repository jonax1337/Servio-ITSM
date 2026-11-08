import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_INCIDENT_STATE_META, TONE_TEXT_CLASSES, metaFor } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export type TimelineEntry = { id: string; state: string; body: string; createdAt: Date; author?: string | null };

/** Status updates, newest first, as a vertical timeline. Used by the console and the portal. */
export async function IncidentTimeline({ updates }: { updates: TimelineEntry[] }) {
  const [t, f] = await Promise.all([getT("status"), getFormatter()]);
  if (updates.length === 0) return <p className="text-sm text-muted-foreground">{t("noUpdates")}</p>;
  return (
    <ol className="grid">
      {updates.map((u, index) => {
        const isLast = index === updates.length - 1;
        const { tone } = metaFor(STATUS_INCIDENT_STATE_META, u.state);
        return (
          <li key={u.id} className="grid grid-cols-[0.75rem_1fr] gap-x-3">
            {/* Dot centred on the badge row; the connector runs down to the next update. */}
            <div className="flex flex-col items-center" aria-hidden>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full bg-current", TONE_TEXT_CLASSES[tone])} />
              {isLast ? null : <span className="mt-1 w-px flex-1 bg-border" />}
            </div>
            <div className={cn("grid min-w-0 gap-1", isLast ? null : "pb-4")}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge map={STATUS_INCIDENT_STATE_META} value={u.state} />
                <time dateTime={u.createdAt.toISOString()}>{f.pattern(u.createdAt, f.locale === "de" ? "d. MMM, HH:mm" : "MMM d, HH:mm")}</time>
                {u.author ? <span>{t("byAuthor", { name: u.author })}</span> : null}
              </div>
              <p className="whitespace-pre-wrap text-sm">{u.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
