import { db } from "@/lib/db";
import { notify } from "@/lib/audit";
import { getBoolSetting, getNumberSetting } from "@/lib/settings";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import { loadBusinessCalendar, slaElapsedPercent } from "@/lib/sla";
import type { BusinessCalendarLike } from "@/lib/business-hours";
import {
  DEFAULT_NUDGE_PERCENT,
  normalizeNudgePercent,
  nudgeMessage,
  shouldNudge,
} from "@/lib/sla-nudge-rules";

/** Most tickets one tick inspects, soonest deadline first; the rest wait for the next tick. */
const NUDGE_BATCH_SIZE = 500;

/**
 * Scheduler tick for SLA nudges: notifies the assignee once per assignee and deadline
 * (Ticket.slaNudgedAt, cleared on reassignment and repricing) when an active ticket
 * crosses the configured share of its resolve SLA
 * (SLA_NUDGE_PERCENT, default 75; SLA_NUDGE_ENABLED, default on). Elapsed time is
 * business-calendar aware and paused tickets are skipped.
 * Run by lib/scheduler.ts with an overlap guard and error isolation.
 */
export async function runSlaNudgeTick(): Promise<void> {
  if (!(await getBoolSetting("SLA_NUDGE_ENABLED", true))) return;
  const threshold = normalizeNudgePercent(await getNumberSetting("SLA_NUDGE_PERCENT", DEFAULT_NUDGE_PERCENT));

  const candidates = await db.ticket.findMany({
    where: {
      status: { in: [...OPEN_TICKET_STATUSES] },
      resolvedAt: null,
      slaNudgedAt: null,
      pendingSince: null,
      resolveDueAt: { not: null },
      assignee: { isActive: true },
    },
    select: {
      id: true,
      prefix: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      pendingSince: true,
      pausedMs: true,
      assigneeId: true,
      slaNudgedAt: true,
      responseDueAt: true,
      resolveDueAt: true,
      dueAt: true,
      sla: { select: { businessCalendarId: true } },
    },
    orderBy: { resolveDueAt: "asc" },
    take: NUDGE_BATCH_SIZE,
  });

  const now = new Date();
  const calendars = new Map<string, BusinessCalendarLike | null>();
  const calendarFor = async (id: string | null | undefined) => {
    if (!id) return null;
    if (!calendars.has(id)) calendars.set(id, await loadBusinessCalendar(id));
    return calendars.get(id) ?? null;
  };

  let nudged = 0;
  for (const ticket of candidates) {
    try {
      const calendar = await calendarFor(ticket.sla?.businessCalendarId);
      const elapsed = slaElapsedPercent(ticket, now, calendar);
      if (elapsed === null || !shouldNudge(ticket, elapsed, threshold)) continue;

      // The marker is claimed first: a concurrent or restarted tick then sees it and stays silent.
      const claimed = await db.ticket.updateMany({
        where: { id: ticket.id, slaNudgedAt: null },
        data: { slaNudgedAt: now },
      });
      if (claimed.count === 0) continue;

      await notify(ticket.assigneeId!, {
        type: "SLA_NUDGE",
        ...nudgeMessage(ticket, elapsed),
        entity: "Ticket",
        entityId: String(ticket.id),
      });
      nudged++;
    } catch (error) {
      console.error(`[servio:sla-nudge] ticket ${ticket.id} failed:`, error);
    }
  }

  if (nudged > 0) console.log(`[servio:sla-nudge] nudged ${nudged} assignee(s) at >= ${threshold}% of the resolve SLA`);
}
