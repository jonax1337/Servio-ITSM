import { z } from "zod";
import { db } from "@/lib/db";
import { resolveGroupId } from "@/lib/ai-tools";
import { loadSchedules, onCallPersonAt, toScheduleInput } from "@/lib/oncall";
import { addOnCallOverride } from "@/lib/oncall-overrides";
import { buildTimeline, parseZonedDateTime } from "@/lib/oncall-rules";
import type { AiOperation } from "../types";
import { err, fromActionResult, ok, str } from "../helpers";

/**
 * On-call schedules.
 *  - `oncall.who` (read, AGENT): who is on call for a team now / at a time
 *  - `oncall.override` (write, MANAGER): put someone on call for a period
 * Overrides go through the same rules as the UI (lib/oncall-overrides.ts).
 */

const LOOKAHEAD_MS = 14 * 24 * 3_600_000;
const TIME_HELP = "'YYYY-MM-DD HH:mm' in the schedule's time zone, or a full ISO timestamp with offset";

type Agent = { id: string; name: string | null; email: string };

const describePerson = (p: Agent) => (p.name ? `${p.name} <${p.email}>` : p.email);

/**
 * Resolve an agent by exact name or email; a partial name only counts when it
 * matches exactly one person, so "Ann" never silently becomes "Joanna".
 */
async function findAgent(query: string): Promise<Agent | { error: string }> {
  const q = query.trim();
  const candidates = await db.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER", "AGENT"] }, OR: [{ name: { contains: q } }, { email: q }] },
    select: { id: true, name: true, email: true },
    take: 6,
  });
  const lower = q.toLowerCase();
  const exact = candidates.filter((c) => c.name?.toLowerCase() === lower || c.email.toLowerCase() === lower);
  const pool = exact.length > 0 ? exact : candidates;
  if (pool.length === 1) return pool[0];
  if (pool.length === 0) return { error: `Person not found: ${query}` };
  return { error: `Several people match "${query}": ${pool.map(describePerson).join(", ")}. Use the exact name or email.` };
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "oncall.who",
    group: "On-call",
    kind: "read",
    minRole: "AGENT",
    description:
      "Who is on call for a team (group) right now, or at a given time: one entry per active on-call schedule with the person and when the shift ends. Say plainly when nobody is on call.",
    input: z.object({
      group: z.string().describe("team (group) name"),
      at: z.string().optional().describe(`point in time, ${TIME_HELP}; default now`),
    }),
    run: async (a) => {
      const group = await resolveGroupId(String(a.group ?? ""));
      if (!group) return err(`Team not found: ${a.group}`);
      const now = new Date();
      const requested = str(a.at);
      const schedules = await loadSchedules({ groupId: group.id, isActive: true }, now, new Date(now.getTime() + LOOKAHEAD_MS));
      if (schedules.length === 0) return ok(`${group.name} has no active on-call schedule.`, { team: group.name, schedules: [] });

      const rows = [];
      for (const schedule of schedules) {
        const at = requested ? parseZonedDateTime(requested, schedule.timezone) : now;
        if (Number.isNaN(at.getTime())) return err(`Could not read the time "${requested}". Use ${TIME_HELP}.`);
        // Overrides beyond the default window are only loaded for "now"; reload for a custom time.
        const scoped = requested
          ? (await loadSchedules({ id: schedule.id }, at, new Date(at.getTime() + LOOKAHEAD_MS)))[0] ?? schedule
          : schedule;
        const person = onCallPersonAt(scoped, at);
        const [slot] = buildTimeline(toScheduleInput(scoped), at, new Date(at.getTime() + LOOKAHEAD_MS));
        rows.push({
          schedule: scoped.name,
          timezone: scoped.timezone,
          onCall: person ? { name: person.name ?? person.email, email: person.email } : null,
          until: person && slot ? slot.end.toISOString() : null,
        });
      }
      const nobody = rows.filter((r) => !r.onCall).length;
      const summary =
        nobody === rows.length
          ? `Nobody is on call for ${group.name}${requested ? ` at ${requested}` : " right now"}.`
          : `On call for ${group.name}: ${rows.map((r) => `${r.onCall?.name ?? "nobody"} (${r.schedule})`).join("; ")}.`;
      return ok(summary, { team: group.name, schedules: rows });
    },
  },
  {
    id: "oncall.override",
    group: "On-call",
    kind: "write",
    minRole: "MANAGER",
    description:
      "Put a person on call for a period on a schedule, overriding the rotation (holiday cover, a swap). Fails when it overlaps an existing override.",
    input: z.object({
      schedule: z.string().describe("on-call schedule name"),
      user: z.string().describe("who will be on call (name or email)"),
      from: z.string().describe(`start, ${TIME_HELP}`),
      to: z.string().describe(`end, ${TIME_HELP}`),
      replaces: z.string().optional().describe("rotation member being replaced (name or email)"),
      reason: z.string().optional(),
    }),
    label: (a) => `Put ${a.user} on call on “${a.schedule}” (${a.from} → ${a.to})`,
    run: async (a, ctx) => {
      const name = String(a.schedule ?? "").trim();
      const matches = await db.onCallSchedule.findMany({
        where: { OR: [{ name }, { name: { contains: name } }] },
        select: { id: true, name: true, timezone: true },
        take: 5,
      });
      const schedule = matches.find((s) => s.name === name) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!schedule) {
        return err(
          matches.length === 0
            ? `On-call schedule not found: ${name}`
            : `Several schedules match "${name}": ${matches.map((s) => s.name).join(", ")}. Use the exact name.`,
        );
      }

      const cover = await findAgent(String(a.user ?? ""));
      if ("error" in cover) return err(cover.error);
      const replacesName = str(a.replaces);
      const replaced = replacesName ? await findAgent(replacesName) : null;
      if (replaced && "error" in replaced) return err(replaced.error);

      const res = await addOnCallOverride(
        { id: ctx.userId, role: ctx.role },
        {
          scheduleId: schedule.id,
          userId: cover.id,
          replacesUserId: replaced?.id ?? null,
          startsAt: parseZonedDateTime(String(a.from ?? ""), schedule.timezone),
          endsAt: parseZonedDateTime(String(a.to ?? ""), schedule.timezone),
          reason: str(a.reason)?.slice(0, 300) ?? null,
        },
      );
      return fromActionResult(res, `${describePerson(cover)} is on call on "${schedule.name}" for the given period.`);
    },
  },
];
