import Link from "next/link";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Snowflake, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANGE_STATUS_META, RISK_META, TONE_CLASSES, changeRef, metaFor } from "@/lib/constants";
import {
  dayWindow,
  daysInRange,
  scheduledWindow,
  windowsOverlap,
  type CalendarView,
  type ScheduledChange,
  type TimeWindow,
} from "@/lib/change-schedule-rules";
import type { FreezeWindowRow } from "@/lib/change-schedule";

export type CalendarColorBy = "status" | "risk";

const MONTH_CELL_CHANGE_LIMIT = 3;
const WEEKDAY_COUNT = 7;

function chipClass(change: ScheduledChange, colorBy: CalendarColorBy): string {
  const meta = colorBy === "risk" ? metaFor(RISK_META, change.risk) : metaFor(CHANGE_STATUS_META, change.status);
  return TONE_CLASSES[meta.tone];
}

function ChangeChip({ change, colorBy, hasConflict, showTime }: {
  change: ScheduledChange;
  colorBy: CalendarColorBy;
  hasConflict: boolean;
  showTime: boolean;
}) {
  const title = `${changeRef(change.id)} ${change.title} · ${format(change.plannedStart, "PP p")} – ${format(change.plannedEnd, "PP p")}`;
  return (
    <Link
      href={`/changes/${change.id}`}
      title={title}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-tight outline-none hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        chipClass(change, colorBy),
      )}
    >
      {hasConflict ? <TriangleAlert className="size-3 shrink-0" aria-label="Schedule conflict" /> : null}
      {showTime ? <span className="shrink-0 tabular-nums opacity-80">{format(change.plannedStart, "HH:mm")}</span> : null}
      <span className="truncate font-medium">{change.title}</span>
    </Link>
  );
}

function FreezeLabel({ freeze }: { freeze: FreezeWindowRow }) {
  const scope = [freeze.serviceName, freeze.groupName].filter(Boolean).join(" · ");
  return (
    <span
      title={`${freeze.name}${scope ? ` (${scope})` : ""} · ${format(freeze.startsAt, "PP p")} – ${format(freeze.endsAt, "PP p")}`}
      className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400"
    >
      <Snowflake className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{freeze.name}</span>
    </span>
  );
}

/** Month or week grid of planned change windows, with freeze windows shading the days they cover. */
export function ChangeCalendarGrid({
  view, anchor, range, changes, freezes, conflictedIds, colorBy, weekHref,
}: {
  view: CalendarView;
  anchor: Date;
  range: TimeWindow;
  changes: ScheduledChange[];
  freezes: FreezeWindowRow[];
  conflictedIds: ReadonlySet<number>;
  colorBy: CalendarColorBy;
  /** Link to the week view containing a day (the "+N more" target in month view). */
  weekHref: (day: Date) => string;
}) {
  const days = daysInRange(range);
  const today = new Date();
  const isWeek = view === "week";

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
          {days.slice(0, WEEKDAY_COUNT).map((day) => (
            <div key={day.getDay()} className="px-2 py-1.5">{format(day, "EEE")}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const slot = dayWindow(day);
            const dayChanges = changes.filter((c) => windowsOverlap(scheduledWindow(c), slot));
            const dayFreezes = freezes.filter((f) => windowsOverlap({ start: f.startsAt, end: f.endsAt }, slot));
            const shown = isWeek ? dayChanges : dayChanges.slice(0, MONTH_CELL_CHANGE_LIMIT);
            const hidden = dayChanges.length - shown.length;
            const outsideMonth = !isWeek && !isSameMonth(day, anchor);
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "grid content-start gap-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                  isWeek ? "min-h-64" : "min-h-28",
                  dayFreezes.length > 0 && "bg-red-500/[0.07]",
                  outsideMonth && "bg-muted/30 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "justify-self-end text-xs tabular-nums",
                    isSameDay(day, today) && "grid size-5 place-items-center rounded-full bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayFreezes.map((freeze) => <FreezeLabel key={freeze.id} freeze={freeze} />)}
                {shown.map((change) => (
                  <ChangeChip
                    key={change.id}
                    change={change}
                    colorBy={colorBy}
                    hasConflict={conflictedIds.has(change.id)}
                    showTime={isWeek}
                  />
                ))}
                {hidden > 0 ? (
                  <Link href={weekHref(day)} className="px-1 text-xs text-muted-foreground hover:text-foreground">
                    +{hidden} more
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
