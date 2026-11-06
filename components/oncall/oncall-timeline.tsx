import { CalendarClock } from "lucide-react";
import { avatarColor, initials } from "@/lib/avatar";
import type { TimelineSegment } from "@/lib/oncall-rules";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { formatDayInZone, formatInZone } from "./format";

export type TimelinePerson = { name: string | null; email: string };

const DAY_MS = 86_400_000;
/** Below this share of the bar a segment is too narrow for a name and shows initials. */
const NAME_MIN_PERCENT = 12;
/** Below this share even initials do not fit; the list and tooltip carry the name. */
const INITIALS_MIN_PERCENT = 3;
/** Long lists scroll instead of pushing the rest of the page down. */
const LIST_SCROLL_AFTER = 8;

function segmentLabel(name: string | null, width: number): string {
  if (!name) return width < INITIALS_MIN_PERCENT ? "" : "Nobody";
  if (width >= NAME_MIN_PERCENT) return name;
  return width >= INITIALS_MIN_PERCENT ? initials(name) : "";
}

/**
 * Who is on call across a period: a proportional bar (one colour per person,
 * overrides outlined, gaps hatched) over a day axis, with the same facts as a
 * list below for screen readers and exact times.
 */
export function OnCallTimeline({
  segments, people, from, to, timezone, now,
}: {
  segments: TimelineSegment[];
  people: Map<string, TimelinePerson>;
  from: Date;
  to: Date;
  timezone: string;
  now: Date;
}) {
  const span = to.getTime() - from.getTime();
  const pct = (t: number) => ((t - from.getTime()) / span) * 100;
  const days = Array.from({ length: Math.round(span / DAY_MS) }, (_, i) => new Date(from.getTime() + i * DAY_MS));
  const personOf = (userId: string | null) => (userId ? people.get(userId) ?? null : null);
  const startLabel = (start: Date) => (start.getTime() === from.getTime() ? "Now" : formatInZone(start, timezone));
  // The last stretch is cut off where the window ends, not where the shift does.
  const endLabel = (end: Date) => (end.getTime() === to.getTime() ? "…" : formatInZone(end, timezone));
  const hasOverride = segments.some((s) => s.source === "OVERRIDE");
  const hasGap = segments.some((s) => s.userId === null);

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="relative h-5 text-[11px] text-muted-foreground" aria-hidden>
            {days.map((day, i) => (
              <span key={day.toISOString()} className="absolute top-0 whitespace-nowrap" style={{ left: `${(i / days.length) * 100}%` }}>
                {i % 2 === 0 ? formatDayInZone(day, timezone) : ""}
              </span>
            ))}
          </div>
          <div className="relative h-9 overflow-hidden rounded-lg border bg-muted/30">
            {segments.map((s) => {
              const person = personOf(s.userId);
              const name = person ? (person.name ?? person.email) : null;
              const width = pct(s.end.getTime()) - pct(s.start.getTime());
              return (
                <div
                  key={s.start.toISOString()}
                  title={`${name ?? "Nobody on call"} · ${startLabel(s.start)} – ${endLabel(s.end)}`}
                  className={cn(
                    "absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-background/60 px-1 text-xs font-medium text-white",
                    width >= NAME_MIN_PERCENT && "justify-start px-2",
                    s.source === "OVERRIDE" && "ring-2 ring-inset ring-white/70",
                    !name && "bg-destructive/10 text-destructive",
                  )}
                  style={{
                    left: `${pct(s.start.getTime())}%`,
                    width: `${width}%`,
                    ...(name ? avatarColor(name) : {}),
                  }}
                >
                  <span className="truncate">{segmentLabel(name, width)}</span>
                </div>
              );
            })}
            {now >= from && now < to ? (
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${pct(now.getTime())}%` }} aria-hidden />
            ) : null}
          </div>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" aria-hidden /> Now</span>
        {hasOverride ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-muted ring-2 ring-inset ring-foreground/50" aria-hidden /> Outlined = override
          </span>
        ) : null}
        {hasGap ? <span className="text-destructive">Nobody is on call for part of this period.</span> : null}
      </p>

      <ul className={cn("divide-y rounded-lg border text-sm", segments.length > LIST_SCROLL_AFTER && "max-h-72 overflow-y-auto")}>
        {segments.map((s) => {
          const person = personOf(s.userId);
          return (
            <li key={s.start.toISOString()} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {person ? (
                <span className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={person.name} email={person.email} size="xs" />
                  <span className="truncate font-medium">{person.name ?? person.email}</span>
                </span>
              ) : (
                <span className="font-medium text-destructive">Nobody on call</span>
              )}
              {s.source === "OVERRIDE" ? (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3" /> Override
                </span>
              ) : null}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {startLabel(s.start)} – {endLabel(s.end)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
