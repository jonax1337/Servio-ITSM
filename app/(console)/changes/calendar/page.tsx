import Link from "next/link";
import { format } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Snowflake, TriangleAlert, Wrench } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasRole, requireUser } from "@/lib/session";
import { buildHref, getParam, type SearchParams } from "@/lib/query";
import { loadSchedule } from "@/lib/change-schedule";
import {
  CALENDAR_VIEWS,
  formatAnchor,
  matchesFilter,
  parseAnchor,
  parseCalendarView,
  shiftAnchor,
  visibleRange,
  type CalendarView,
} from "@/lib/change-schedule-rules";
import { CHANGE_STATUS_META, CHANGE_STATUSES, RISK_META, RISKS, changeRef } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { CalendarFilters } from "@/components/changes/calendar/calendar-filters";
import { ChangeCalendarGrid, type CalendarColorBy } from "@/components/changes/calendar/change-calendar-grid";

export const metadata: Metadata = { title: "Change Calendar" };
export const dynamic = "force-dynamic";

const CALENDAR_PATH = "/changes/calendar";
const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week" };
const COLOR_BY_OPTIONS: { value: CalendarColorBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "risk", label: "Risk" },
];

function periodLabel(view: CalendarView, start: Date, anchor: Date): string {
  return view === "month" ? format(anchor, "MMMM yyyy") : `Week of ${format(start, "PP")}`;
}

function SegmentedLinks<T extends string>({ label, options, active, hrefFor }: {
  label: string;
  options: { value: T; label: string }[];
  active: T;
  hrefFor: (value: T) => string;
}) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
      {options.map((option) => (
        <Link
          key={option.value}
          href={hrefFor(option.value)}
          aria-current={option.value === active ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            option.value === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function ChangeCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const view = parseCalendarView(getParam(sp, "view"));
  const colorBy: CalendarColorBy = getParam(sp, "color") === "risk" ? "risk" : "status";
  const anchor = parseAnchor(getParam(sp, "date"), new Date());
  const range = visibleRange(view, anchor);
  const filter = { groupId: getParam(sp, "team"), risk: getParam(sp, "risk"), status: getParam(sp, "status") };

  const [schedule, teams] = await Promise.all([
    loadSchedule(range),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const changes = schedule.changes.filter((c) => matchesFilter(c, filter));
  const changesById = new Map(schedule.changes.map((c) => [c.id, c]));
  const visibleIds = new Set(changes.map((c) => c.id));
  const conflicts = schedule.conflicts.filter((c) => visibleIds.has(c.first) || visibleIds.has(c.second));
  const conflictedIds = new Set(conflicts.flatMap((c) => [c.first, c.second]));

  const href = (patch: Record<string, string | null>) => buildHref(CALENDAR_PATH, sp, patch);
  const legend =
    colorBy === "risk"
      ? RISKS.map((r) => RISK_META[r])
      : CHANGE_STATUSES.filter((s) => s !== "CANCELLED").map((s) => CHANGE_STATUS_META[s]);

  return (
    <>
      <PageHeader
        icon={CalendarRange}
        title="Change Calendar"
        description="Planned windows of all changes, with change freezes, Servio maintenance and schedule conflicts."
      >
        {hasRole(me.role, "MANAGER") ? (
          <LinkButton href="/changes/freeze" variant="outline">
            <Snowflake className="size-4" /> Freeze windows
          </LinkButton>
        ) : null}
        <LinkButton href="/changes/new">
          <Plus className="size-4" /> New change
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <LinkButton
              href={href({ date: formatAnchor(shiftAnchor(view, anchor, -1)) })}
              variant="outline"
              size="icon-sm"
              aria-label="Previous period"
            >
              <ChevronLeft className="size-4" />
            </LinkButton>
            <LinkButton href={href({ date: null })} variant="outline" size="sm">
              Today
            </LinkButton>
            <LinkButton
              href={href({ date: formatAnchor(shiftAnchor(view, anchor, 1)) })}
              variant="outline"
              size="icon-sm"
              aria-label="Next period"
            >
              <ChevronRight className="size-4" />
            </LinkButton>
          </div>
          <h2 className="font-display text-base font-semibold">{periodLabel(view, range.start, anchor)}</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SegmentedLinks
              label="Calendar view"
              options={CALENDAR_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
              active={view}
              hrefFor={(value) => href({ view: value === "month" ? null : value })}
            />
            <SegmentedLinks
              label="Colour by"
              options={COLOR_BY_OPTIONS}
              active={colorBy}
              hrefFor={(value) => href({ color: value === "status" ? null : value })}
            />
          </div>
        </div>

        <CalendarFilters teams={teams} />

        {changes.length === 0 && schedule.freezes.length === 0 && schedule.maintenance.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="Nothing planned in this period"
            description="Changes appear here once they have a planned window. Adjust the filters or move to another period."
          />
        ) : null}

        <ChangeCalendarGrid
          view={view}
          anchor={anchor}
          range={range}
          changes={changes}
          freezes={schedule.freezes}
          maintenance={schedule.maintenance}
          maintenanceHref={hasRole(me.role, "ADMIN") ? "/settings/updates" : null}
          conflictedIds={conflictedIds}
          colorBy={colorBy}
          weekHref={(day) => href({ view: "week", date: formatAnchor(day) })}
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {legend.map((meta) => (
            <ToneBadge key={meta.label} meta={meta} dot icon={false} />
          ))}
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            <Snowflake className="size-3.5" aria-hidden /> Change freeze (shaded days)
          </span>
          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
            <Wrench className="size-3.5" aria-hidden /> Maintenance window (Servio unavailable or updating)
          </span>
          <span className="inline-flex items-center gap-1">
            <TriangleAlert className="size-3.5" aria-hidden /> Schedule conflict
          </span>
        </div>

        {conflicts.length > 0 ? (
          <section className="rounded-xl border bg-card p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <TriangleAlert className="size-4 text-amber-500" aria-hidden /> Schedule conflicts in this period
            </h3>
            <ul className="grid gap-1.5 text-sm">
              {conflicts.map((conflict) => {
                const pair = [changesById.get(conflict.first), changesById.get(conflict.second)];
                if (!pair[0] || !pair[1]) return null;
                return (
                  <li key={`${conflict.first}-${conflict.second}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {pair.map((change, index) =>
                      change ? (
                        <span key={change.id} className="inline-flex items-center gap-1.5">
                          {index === 1 ? <span className="text-muted-foreground">overlaps</span> : null}
                          <Link href={`/changes/${change.id}`} className="font-medium hover:text-primary">
                            <span className="font-mono text-xs text-muted-foreground">{changeRef(change.id)}</span>{" "}
                            {change.title}
                          </Link>
                          <StatusBadge map={CHANGE_STATUS_META} value={change.status} />
                        </span>
                      ) : null,
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
