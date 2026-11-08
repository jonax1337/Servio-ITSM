/**
 * Scheduler tick for recurring tickets: creates the ticket of every occurrence
 * whose creation window has opened (`createBeforeDays` before it is due).
 * Run by lib/scheduler.ts with an overlap guard and error isolation; gated by
 * RECURRING_TICKETS_ENABLED.
 *
 * Decisions live in lib/recurring-ticket-rules.ts, the claim + ticket creation
 * in lib/recurring-tickets.ts; this file only selects candidates. After a
 * downtime a schedule creates at most one missed occurrence (the latest), then
 * every occurrence whose window is open now (several when the lead time spans
 * more than one step) — never a backlog of past ones.
 */
import { db } from "@/lib/db";
import { getBoolSetting } from "@/lib/settings";
import { getAutomationUserId } from "@/lib/system-user";
import { fireRecurringTicket } from "@/lib/recurring-tickets";
import { MAX_CREATE_BEFORE_DAYS, MAX_OPEN_OCCURRENCES } from "@/lib/recurring-ticket-rules";

const DAY_MS = 86_400_000;
/** Catch-up + every open occurrence (a lead time can span several steps); a guard against a runaway loop on bad data. */
const MAX_FIRES_PER_SCHEDULE = MAX_OPEN_OCCURRENCES + 2;

export async function runRecurringTicketsTick(): Promise<void> {
  if (!(await getBoolSetting("RECURRING_TICKETS_ENABLED", true))) return;

  const now = new Date();
  // A creation window opens at most MAX_CREATE_BEFORE_DAYS (+1 for DST) before the
  // due date, so later occurrences can't be open yet; the exact check is per row.
  const horizon = new Date(now.getTime() + (MAX_CREATE_BEFORE_DAYS + 1) * DAY_MS);
  const candidates = await db.recurringTicket.findMany({
    where: { isActive: true, nextDueAt: { lte: horizon } },
    orderBy: { nextDueAt: "asc" },
    select: { id: true },
  });
  if (candidates.length === 0) return;

  const actorId = await getAutomationUserId();
  let created = 0;
  let failed = 0;
  for (const { id } of candidates) {
    for (let i = 0; i < MAX_FIRES_PER_SCHEDULE; i++) {
      // Re-read each round: the previous fire moved nextDueAt, and an edit may have landed.
      const row = await db.recurringTicket.findUnique({ where: { id } });
      if (!row || !row.isActive) break;
      const res = await fireRecurringTicket(row, { now, trigger: "SCHEDULE", actorId });
      if (res.status === "CREATED") created++;
      else if (res.status === "FAILED") failed++;
      if (res.status !== "CREATED") break;
    }
  }
  if (created > 0 || failed > 0) {
    console.log(`[servio:recurring-tickets] created ${created} ticket(s), ${failed} failed`);
  }
}
