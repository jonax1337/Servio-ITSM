import {
  buildTimeline,
  isValidHandoffTime,
  isValidTimeZone,
  parseCalendarDate,
  shiftHours,
  zonedWallToUtc,
} from "@/lib/oncall-rules";
import { UserAvatar } from "@/components/user-avatar";
import { formatInZone } from "./format";

const HOUR_MS = 3_600_000;
const PREVIEW_SHIFTS = 4;

type PreviewPerson = { id: string; name: string | null; email: string };

/** The first few shifts a rotation setup produces, so a manager sees what the settings mean before saving. */
export function RotationPreview({
  rotationType, customIntervalHours, handoffTime, timezone, startDate, members,
}: {
  rotationType: string;
  customIntervalHours: number | null;
  handoffTime: string;
  timezone: string;
  startDate: string;
  /** Rotation members in shift order. */
  members: PreviewPerson[];
}) {
  const date = parseCalendarDate(startDate);
  const hours = shiftHours({ rotationType, customIntervalHours });
  if (!date || hours == null || !isValidHandoffTime(handoffTime) || !isValidTimeZone(timezone)) return null;

  if (members.length === 0) {
    return <p className="text-xs text-muted-foreground">Add people to the rotation to preview who takes which shift.</p>;
  }

  const rotationStart = zonedWallToUtc(date, handoffTime, timezone);
  const shifts = Math.min(Math.max(members.length, 2), PREVIEW_SHIFTS);
  const byId = new Map(members.map((m) => [m.id, m]));
  const segments = buildTimeline(
    { rotationType, customIntervalHours, handoffTime, timezone, rotationStart, memberIds: members.map((m) => m.id), overrides: [] },
    rotationStart,
    // Cut mid-shift after the last previewed one, so every shown shift keeps its real end.
    new Date(rotationStart.getTime() + (shifts + 0.5) * hours * HOUR_MS),
  ).slice(0, shifts);

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Preview{members.length === 1 ? ": the same person covers every shift" : ""}
      </p>
      <ul className="grid gap-1.5">
        {segments.map((s) => {
          const person = s.userId ? byId.get(s.userId) : null;
          return (
            <li key={s.start.toISOString()} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <UserAvatar name={person?.name} email={person?.email} size="xs" />
              <span className="font-medium">{person?.name ?? person?.email}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatInZone(s.start, timezone)}{members.length === 1 ? "" : ` – ${formatInZone(s.end, timezone)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
