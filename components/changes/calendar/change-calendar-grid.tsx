import Link from "next/link";
import { isSameDay, isSameMonth } from "date-fns";
import { Snowflake, TriangleAlert, Wrench } from "lucide-react";
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
import type { FreezeWindowRow, MaintenanceWindowRow } from "@/lib/change-schedule";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translate";

type I18n = { t: Translator<"changes">; f: Formatter };
const span = (start: Date, end: Date, f: Formatter) => `${f.date(start, "dateTime")} – ${f.date(end, "dateTime")}`;

export type CalendarColorBy = "status" | "risk";

const MONTH_CELL_CHANGE_LIMIT = 3;
const WEEKDAY_COUNT = 7;

function chipClass(change: ScheduledChange, colorBy: CalendarColorBy): string {
  const meta = colorBy === "risk" ? metaFor(RISK_META, change.risk) : metaFor(CHANGE_STATUS_META, change.status);
  return TONE_CLASSES[meta.tone];
}

function ChangeChip({ change, colorBy, hasConflict, showTime, i18n: { t, f } }: {
  change: ScheduledChange;
  colorBy: CalendarColorBy;
  hasConflict: boolean;
  showTime: boolean;
  i18n: I18n;
}) {
  const title = `${changeRef(change.id)} ${change.title} · ${span(change.plannedStart, change.plannedEnd, f)}`;
  return (
    <Link
      href={`/changes/${change.id}`}
      title={title}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-tight outline-none hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        chipClass(change, colorBy),
      )}
    >
      {hasConflict ? <TriangleAlert className="size-3 shrink-0" aria-label={t("calendar.conflict")} /> : null}
      {showTime ? <span className="shrink-0 tabular-nums opacity-80">{f.date(change.plannedStart, "time")}</span> : null}
      <span className="truncate font-medium">{change.title}</span>
    </Link>
  );
}

function FreezeLabel({ freeze, f }: { freeze: FreezeWindowRow; f: Formatter }) {
  const scope = [freeze.serviceName, freeze.groupName].filter(Boolean).join(" · ");
  return (
    <span
      title={`${freeze.name}${scope ? ` (${scope})` : ""} · ${span(freeze.startsAt, freeze.endsAt, f)}`}
      className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400"
    >
      <Snowflake className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{freeze.name}</span>
    </span>
  );
}

/** A maintenance window on a day it covers; links to the admin page that manages it. */
function MaintenanceLabel({ window, href, i18n: { t, f } }: { window: MaintenanceWindowRow; href: string | null; i18n: I18n }) {
  const label = (
    <>
      <Wrench className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{window.title}</span>
    </>
  );
  const className = "flex min-w-0 items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400";
  const title = t("calendar.maintenanceTitle", { title: window.title, window: span(window.startsAt, window.endsAt, f) });
  return href ? (
    <Link href={href} title={title} className={cn(className, "hover:underline")}>
      {label}
    </Link>
  ) : (
    <span title={title} className={className}>
      {label}
    </span>
  );
}

/** Month or week grid of planned change windows, with freeze and maintenance windows marking the days they cover. */
export async function ChangeCalendarGrid({
  view, anchor, range, changes, freezes, maintenance, maintenanceHref, conflictedIds, colorBy, weekHref,
}: {
  view: CalendarView;
  anchor: Date;
  range: TimeWindow;
  changes: ScheduledChange[];
  freezes: FreezeWindowRow[];
  maintenance: MaintenanceWindowRow[];
  /** Where a maintenance window links to, or null when the viewer may not open it. */
  maintenanceHref: string | null;
  conflictedIds: ReadonlySet<number>;
  colorBy: CalendarColorBy;
  /** Link to the week view containing a day (the "+N more" target in month view). */
  weekHref: (day: Date) => string;
}) {
  const [t, f] = await Promise.all([getT("changes"), getFormatter()]);
  const i18n: I18n = { t, f };
  const days = daysInRange(range);
  const today = new Date();
  const isWeek = view === "week";

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
          {days.slice(0, WEEKDAY_COUNT).map((day) => (
            <div key={day.getDay()} className="px-2 py-1.5">{f.pattern(day, "EEE")}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const slot = dayWindow(day);
            const dayChanges = changes.filter((c) => windowsOverlap(scheduledWindow(c), slot));
            const dayFreezes = freezes.filter((fr) => windowsOverlap({ start: fr.startsAt, end: fr.endsAt }, slot));
            const dayMaintenance = maintenance.filter((m) => windowsOverlap({ start: m.startsAt, end: m.endsAt }, slot));
            const shown = isWeek ? dayChanges : dayChanges.slice(0, MONTH_CELL_CHANGE_LIMIT);
            const hidden = dayChanges.length - shown.length;
            const outsideMonth = !isWeek && !isSameMonth(day, anchor);
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "grid content-start gap-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                  isWeek ? "min-h-64" : "min-h-28",
                  dayMaintenance.length > 0 && "bg-sky-500/[0.07]",
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
                  {f.pattern(day, "d")}
                </span>
                {dayFreezes.map((freeze) => <FreezeLabel key={freeze.id} freeze={freeze} f={f} />)}
                {dayMaintenance.map((window) => <MaintenanceLabel key={window.id} window={window} href={maintenanceHref} i18n={i18n} />)}
                {shown.map((change) => (
                  <ChangeChip
                    key={change.id}
                    change={change}
                    colorBy={colorBy}
                    hasConflict={conflictedIds.has(change.id)}
                    showTime={isWeek}
                    i18n={i18n}
                  />
                ))}
                {hidden > 0 ? (
                  <Link href={weekHref(day)} className="px-1 text-xs text-muted-foreground hover:text-foreground">
                    {t("calendar.more", { count: hidden })}
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
