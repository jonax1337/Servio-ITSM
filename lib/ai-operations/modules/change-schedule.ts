import { addDays, format, isValid, startOfDay } from "date-fns";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveGroupId } from "@/lib/ai-tools";
import { createFreezeWindow } from "@/lib/actions/change-freeze";
import { loadSchedule } from "@/lib/change-schedule";
import { conflictsOf, describeFreeze, otherChangeId } from "@/lib/change-schedule-rules";
import { changeRef } from "@/lib/constants";
import type { AiOperation } from "../types";
import { err, fromActionResult, ok, str, toFormData } from "../helpers";

/**
 * Change calendar & freeze windows. Both operations reuse the loaders and the server action
 * of the UI, so Sable sees and may do exactly what a user of /changes/calendar can.
 */

const DEFAULT_SPAN_DAYS = 30;
const MAX_SPAN_DAYS = 366;
const MAX_LISTED_CHANGES = 100;
const SCHEDULE_DATE_FORMAT = "yyyy-MM-dd HH:mm";

function parseDate(value: unknown): Date | null {
  const text = str(value);
  if (!text) return null;
  const date = new Date(text);
  return isValid(date) ? date : null;
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "change.schedule",
    group: "Change calendar",
    kind: "read",
    minRole: "AGENT",
    description:
      "List the planned change windows, schedule conflicts (changes that overlap in time and share a configuration item or service) and change freeze windows for a period. Defaults to the next 30 days. Use it before proposing a maintenance window or when asked what is planned, what collides or whether a freeze is in effect.",
    input: z.object({
      from: z.string().optional().describe("period start, ISO date (default: today)"),
      to: z.string().optional().describe("period end, ISO date (default: 30 days after `from`)"),
      onlyConflicts: z.boolean().optional().describe("list only changes that are part of a conflict"),
    }),
    run: async (a) => {
      const start = parseDate(a.from) ?? startOfDay(new Date());
      const end = parseDate(a.to) ?? addDays(start, DEFAULT_SPAN_DAYS);
      if (end.getTime() <= start.getTime()) return err("`to` must be after `from`.");
      if (end.getTime() - start.getTime() > MAX_SPAN_DAYS * 86_400_000) {
        return err(`The period may span at most ${MAX_SPAN_DAYS} days.`);
      }

      const { changes, freezes, conflicts } = await loadSchedule({ start, end });
      const conflicted = new Set(conflicts.flatMap((c) => [c.first, c.second]));
      const listed = (a.onlyConflicts === true ? changes.filter((c) => conflicted.has(c.id)) : changes)
        .slice(0, MAX_LISTED_CHANGES)
        .map((c) => ({
          ref: changeRef(c.id),
          title: c.title,
          status: c.status,
          type: c.type,
          risk: c.risk,
          start: format(c.plannedStart, SCHEDULE_DATE_FORMAT),
          end: format(c.plannedEnd, SCHEDULE_DATE_FORMAT),
          conflictsWith: conflictsOf(c.id, conflicts).map((x) => changeRef(otherChangeId(c.id, x))),
        }));

      const summary =
        `${changes.length} planned change${changes.length === 1 ? "" : "s"}, ` +
        `${conflicts.length} schedule conflict${conflicts.length === 1 ? "" : "s"}, ` +
        `${freezes.length} freeze window${freezes.length === 1 ? "" : "s"} between ` +
        `${format(start, "yyyy-MM-dd")} and ${format(end, "yyyy-MM-dd")}.`;
      return ok(summary, {
        changes: listed,
        freezes: freezes.map((f) => ({ name: f.name, window: describeFreeze(f), service: f.serviceName, team: f.groupName })),
      });
    },
  },
  {
    id: "freeze.create",
    group: "Change calendar",
    kind: "write",
    minRole: "MANAGER",
    description:
      "Create a change freeze window: a period in which planned changes cannot be submitted or rescheduled (emergency changes may override it with a justification). Without a service or team it applies to all changes; with either it applies only to matching changes.",
    input: z.object({
      name: z.string().min(2).describe("freeze window name, e.g. 'Year-end freeze'"),
      startsAt: z.string().describe("start, ISO 8601 date and time"),
      endsAt: z.string().describe("end, ISO 8601 date and time (after the start)"),
      reason: z.string().optional().describe("why changes are paused"),
      service: z.string().optional().describe("service name to scope the freeze to"),
      team: z.string().optional().describe("team (group) name to scope the freeze to"),
    }),
    label: (a) => `Create change freeze “${a.name}” (${a.startsAt} – ${a.endsAt})`,
    run: async (a) => {
      const serviceName = str(a.service);
      const service = serviceName ? await db.service.findFirst({ where: { name: serviceName }, select: { id: true } }) : null;
      if (serviceName && !service) return err(`Service not found: ${serviceName}`);
      const teamName = str(a.team);
      const team = teamName ? await resolveGroupId(teamName) : null;
      if (teamName && !team) return err(`Team not found: ${teamName}`);

      const res = await createFreezeWindow(
        toFormData({
          name: a.name,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          reason: str(a.reason),
          serviceId: service?.id,
          groupId: team?.id,
        }),
      );
      return fromActionResult(res, `Created change freeze "${a.name}"`);
    },
  },
];
