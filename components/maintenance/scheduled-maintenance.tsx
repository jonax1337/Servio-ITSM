import { CalendarClock, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { listOpenWindows } from "@/lib/maintenance";
import { MAINTENANCE_STATUS_META, TONE_BANNER_CLASSES, TONE_TEXT_CLASSES, metaFor } from "@/lib/constants";
import { StatusBadge } from "@/components/status-badge";
import { LocalPeriod } from "@/components/maintenance/local-period";

/** Upcoming and running maintenance windows for the status pages; renders nothing when there are none. */
export async function ScheduledMaintenance({ className }: { className?: string }) {
  const windows = await listOpenWindows();
  if (windows.length === 0) return null;

  return (
    <section aria-labelledby="scheduled-maintenance" className={cn("grid gap-3", className)}>
      <h2 id="scheduled-maintenance" className="flex items-center gap-2 font-medium">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Scheduled maintenance
      </h2>
      {windows.map((window) => {
        const { tone } = metaFor(MAINTENANCE_STATUS_META, window.status);
        return (
          <article key={window.id} className={cn("grid gap-1 rounded-xl border p-4", TONE_BANNER_CLASSES[tone])}>
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className={cn("size-4 shrink-0", TONE_TEXT_CLASSES[tone])} aria-hidden />
              <h3 className="font-medium">{window.title}</h3>
              <StatusBadge map={MAINTENANCE_STATUS_META} value={window.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              <LocalPeriod startsAt={window.startsAt.toISOString()} endsAt={window.endsAt.toISOString()} />
            </p>
            <p className="text-sm">{window.message ?? (window.blockAccess ? "Servio will be unavailable." : "")}</p>
          </article>
        );
      })}
    </section>
  );
}
