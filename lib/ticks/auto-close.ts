/**
 * Scheduler tick that closes resolved tickets automatically: a ticket that has been
 * RESOLVED for TICKET_AUTO_CLOSE_DAYS days (Settings › Tickets; 0 = off, the default)
 * moves to CLOSED, with an internal note and an audit entry by the Automation account.
 * Run by lib/scheduler.ts with an overlap guard and error isolation.
 *
 * A requester reply before the deadline reopens the ticket as before
 * (lib/ticket-core.ts reopenOnCustomerReply); a resolve after a reopen stamps a new
 * resolvedAt, so the countdown starts again. The workflow configuration is honoured:
 * when RESOLVED → CLOSED is disallowed, nothing is closed. Decisions live in
 * lib/auto-close-rules.ts.
 */
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getTicketAutoCloseDays } from "@/lib/settings";
import { getAutomationUserId } from "@/lib/system-user";
import { canTransitionConfigured } from "@/lib/workflow";
import { runAutomations } from "@/lib/automations";
import { autoCloseAuditSummary, autoCloseCutoff } from "@/lib/auto-close-rules";

/** Most tickets one tick closes, oldest resolution first; the rest wait for the next tick. */
const AUTO_CLOSE_BATCH_SIZE = 200;

export async function runAutoCloseTick(): Promise<void> {
  const days = await getTicketAutoCloseDays();
  const now = new Date();
  const cutoff = autoCloseCutoff(now, days);
  if (!cutoff) return;
  // The policy is an admin decision, so the admin's view of the workflow applies.
  if (!(await canTransitionConfigured("TICKET", "RESOLVED", "CLOSED", "ADMIN"))) return;

  const due = await db.ticket.findMany({
    where: { status: "RESOLVED", resolvedAt: { not: null, lte: cutoff } },
    select: { id: true, resolvedAt: true },
    orderBy: { resolvedAt: "asc" },
    take: AUTO_CLOSE_BATCH_SIZE,
  });
  if (due.length === 0) return;

  const actorId = await getAutomationUserId();
  const summary = autoCloseAuditSummary(days);
  let closed = 0;
  for (const ticket of due) {
    try {
      // Claim with a conditional write: a reopen or an agent's change since the read wins.
      const claimed = await db.ticket.updateMany({
        where: { id: ticket.id, status: "RESOLVED", resolvedAt: ticket.resolvedAt },
        data: { status: "CLOSED", closedAt: now },
      });
      if (claimed.count === 0) continue;
      await db.ticketComment.create({
        data: { ticketId: ticket.id, authorId: actorId, isInternal: true, body: `${summary}.` },
      });
      await writeAudit({
        userId: actorId,
        action: "UPDATE",
        entity: "Ticket",
        entityId: ticket.id,
        summary,
        meta: { autoClose: true, days, from: "RESOLVED", to: "CLOSED" },
      });
      await runAutomations("TICKET_UPDATED", ticket.id);
      closed++;
    } catch (error) {
      console.error(`[servio:auto-close] ticket ${ticket.id} failed:`, error);
    }
  }
  if (closed > 0) console.log(`[servio:auto-close] closed ${closed} ticket(s) resolved for ${days}+ day(s)`);
}
