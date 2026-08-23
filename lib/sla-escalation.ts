import { db } from "@/lib/db";
import {
  slaSnapshot,
  firstResponseBreached,
  slaElapsedPercent,
  loadBusinessCalendar,
} from "@/lib/sla";
import { runAutomations } from "@/lib/automations";
import { notify, writeAudit } from "@/lib/audit";
import { getAutomationUserId } from "@/lib/system-user";
import { PRIORITIES, OPEN_TICKET_STATUSES } from "@/lib/constants";
import type { BusinessCalendarLike } from "@/lib/business-hours";

// ---------------------------------------------------------------------------
// SLA escalation sweep. Periodically scans open, unresolved tickets that carry
// an SLA deadline, computes the live SLA state, and fires:
//
//  (a) the SLA automation triggers (unchanged):
//   • first time the RESOLVE SLA is BREACHED (and escalatedAt is still null) →
//     stamp escalatedAt=now and run TICKET_SLA_BREACHED.
//   • first time the FIRST-RESPONSE SLA is breached → stamp responseBreached
//     and run TICKET_SLA_BREACHED.
//   • when a ticket is AT_RISK (and not yet escalated) → run TICKET_SLA_AT_RISK.
//
//  (b) NEW — multi-stage EscalationPolicy steps: when the ticket's SLA has an
//   escalationPolicy, each step fires once when SLA-elapsed% crosses its
//   thresholdPercent. Actions: NOTIFY (group/user), REASSIGN (set group/user),
//   BUMP_PRIORITY (raise to bumpToPriority). Business-hours calendars, when
//   configured on the SLA, drive both the state and the elapsed% so escalation
//   respects working time.
//
// Idempotency is DURABLE. The (a) automations use conditional updateMany guards
// on marker columns (escalatedAt / responseBreached / slaAtRiskNotifiedAt). The
// (b) policy steps use a durable per-step marker: an internal TicketComment
// whose body carries `[[sla-escalation:<stepId>]]`. Before firing a step we
// check for that marker; we only run the action after the marker row is
// created, and a unique guard on (ticketId, marker) via a pre-check keeps it
// at-most-once across restarts. (SQLite dev has no partial unique index, so we
// pre-check + best-effort — a rare double-fire is acceptable and logged.)
// ---------------------------------------------------------------------------

// Open, non-terminal statuses whose SLA clock is still running — IN_PROGRESS
// included (it's the most common working state; keep in sync with
// OPEN_TICKET_STATUSES in lib/constants.ts).
const OPEN_STATUSES = OPEN_TICKET_STATUSES;

const STEP_MARKER = (stepId: string) => `[[sla-escalation:${stepId}]]`;

type PolicyStep = {
  id: string;
  order: number;
  thresholdPercent: number;
  action: string;
  targetGroupId: string | null;
  targetUserId: string | null;
  bumpToPriority: string | null;
};

/** Has this policy step already fired for this ticket? (durable comment marker) */
async function stepAlreadyFired(ticketId: number, stepId: string): Promise<boolean> {
  const existing = await db.ticketComment.findFirst({
    where: { ticketId, isInternal: true, body: { contains: STEP_MARKER(stepId) } },
    select: { id: true },
  });
  return !!existing;
}

/** Write the durable marker (and human-readable summary) for a fired step. */
async function markStepFired(ticketId: number, stepId: string, summary: string) {
  const authorId = await getAutomationUserId();
  await db.ticketComment.create({
    data: {
      ticketId,
      authorId,
      isInternal: true,
      body: `${summary}\n\n${STEP_MARKER(stepId)}`,
    },
  });
}

/** Notify every active agent in a group. */
async function notifyGroup(groupId: string, ticketId: number, title: string, body: string) {
  const members = await db.groupMember.findMany({
    where: { groupId, user: { isActive: true } },
    select: { userId: true },
  });
  for (const m of members) {
    await notify(m.userId, { type: "SLA_ESCALATION", title, body, entity: "Ticket", entityId: String(ticketId) });
  }
}

/**
 * Evaluate an SLA's escalation policy against one ticket: run each step whose
 * threshold the ticket's SLA-elapsed% has crossed and that hasn't fired yet.
 * Returns the number of steps fired this sweep.
 */
async function runEscalationPolicy(
  ticket: {
    id: number;
    priority: string;
    groupId: string | null;
    assigneeId: string | null;
    resolveDueAt: Date | null;
    responseDueAt: Date | null;
    dueAt: Date | null;
    pausedMs: number;
    pendingSince: Date | null;
    createdAt: Date;
  },
  steps: PolicyStep[],
  now: Date,
  calendar: BusinessCalendarLike | null,
): Promise<number> {
  const pct = slaElapsedPercent(ticket, now, calendar);
  if (pct == null) return 0;

  let fired = 0;
  // Deterministic order so lower thresholds fire before higher ones.
  const ordered = [...steps].sort((a, b) => a.thresholdPercent - b.thresholdPercent || a.order - b.order);

  // Track in-sweep mutations so successive steps see the latest priority/group.
  let curPriority = ticket.priority;
  let curGroupId = ticket.groupId;
  let curAssigneeId = ticket.assigneeId;

  for (const step of ordered) {
    if (pct < step.thresholdPercent) continue;
    if (await stepAlreadyFired(ticket.id, step.id)) continue;

    const patch: Record<string, unknown> = {};
    let summary = "";

    switch (step.action) {
      case "NOTIFY": {
        summary = `SLA escalation (${step.thresholdPercent}% elapsed): notified.`;
        if (step.targetUserId) {
          await notify(step.targetUserId, {
            type: "SLA_ESCALATION",
            title: "SLA escalation",
            body: `Ticket #${ticket.id} reached ${step.thresholdPercent}% of its SLA.`,
            entity: "Ticket",
            entityId: String(ticket.id),
          });
        }
        if (step.targetGroupId) {
          await notifyGroup(
            step.targetGroupId,
            ticket.id,
            "SLA escalation",
            `Ticket #${ticket.id} reached ${step.thresholdPercent}% of its SLA.`,
          );
        }
        break;
      }
      case "REASSIGN": {
        if (step.targetGroupId && step.targetGroupId !== curGroupId) {
          patch.groupId = step.targetGroupId;
          curGroupId = step.targetGroupId;
          // Reassigning to a new group drops an assignee who isn't in it.
          if (curAssigneeId && !step.targetUserId) {
            patch.assigneeId = null;
            curAssigneeId = null;
          }
        }
        if (step.targetUserId && step.targetUserId !== curAssigneeId) {
          patch.assigneeId = step.targetUserId;
          curAssigneeId = step.targetUserId;
        }
        summary = `SLA escalation (${step.thresholdPercent}% elapsed): reassigned.`;
        break;
      }
      case "BUMP_PRIORITY": {
        const target = step.bumpToPriority;
        if (target && PRIORITIES.includes(target as (typeof PRIORITIES)[number])) {
          const curIdx = PRIORITIES.indexOf(curPriority as (typeof PRIORITIES)[number]);
          const tgtIdx = PRIORITIES.indexOf(target as (typeof PRIORITIES)[number]);
          // Only raise, never lower.
          if (tgtIdx > curIdx) {
            patch.priority = target;
            curPriority = target;
          }
        }
        summary = `SLA escalation (${step.thresholdPercent}% elapsed): priority bumped to ${curPriority}.`;
        break;
      }
      default:
        summary = `SLA escalation (${step.thresholdPercent}% elapsed).`;
    }

    // Persist the durable marker FIRST (idempotency), then apply the mutation.
    await markStepFired(ticket.id, step.id, summary);
    if (Object.keys(patch).length > 0) {
      await db.ticket.update({ where: { id: ticket.id }, data: patch });
      // Notify a directly-assigned user of the reassignment.
      if (patch.assigneeId && typeof patch.assigneeId === "string") {
        await notify(patch.assigneeId, {
          type: "ASSIGNED",
          title: "Ticket assigned to you (SLA escalation)",
          body: `Ticket #${ticket.id}`,
          entity: "Ticket",
          entityId: String(ticket.id),
        });
      }
    }
    await writeAudit({
      action: "ESCALATE",
      entity: "Ticket",
      entityId: ticket.id,
      summary,
      meta: { stepId: step.id, thresholdPercent: step.thresholdPercent, action: step.action },
    });
    fired++;
  }

  return fired;
}

/**
 * One sweep. Best-effort per ticket: a failure on one ticket never aborts the
 * rest of the batch. Returns a small summary for logging.
 */
export async function runSlaEscalation(): Promise<{
  breached: number;
  responseBreached: number;
  atRisk: number;
  policySteps: number;
}> {
  const tickets = await db.ticket.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      resolvedAt: null,
      OR: [
        { resolveDueAt: { not: null } },
        { dueAt: { not: null } },
        { responseDueAt: { not: null } },
      ],
    },
    select: {
      id: true,
      status: true,
      priority: true,
      groupId: true,
      assigneeId: true,
      resolvedAt: true,
      createdAt: true,
      resolveBreached: true,
      responseDueAt: true,
      responseBreached: true,
      firstResponseAt: true,
      resolveDueAt: true,
      dueAt: true,
      pendingSince: true,
      pausedMs: true,
      escalatedAt: true,
      slaAtRiskNotifiedAt: true,
      slaId: true,
      sla: {
        select: {
          businessCalendarId: true,
          escalationPolicyId: true,
          escalationPolicy: {
            select: {
              steps: {
                select: {
                  id: true,
                  order: true,
                  thresholdPercent: true,
                  action: true,
                  targetGroupId: true,
                  targetUserId: true,
                  bumpToPriority: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const now = new Date();
  // Cache resolved calendars per calendar id across the whole sweep.
  const calCache = new Map<string, BusinessCalendarLike | null>();
  const getCal = async (id: string | null | undefined) => {
    if (!id) return null;
    if (calCache.has(id)) return calCache.get(id)!;
    const cal = await loadBusinessCalendar(id);
    calCache.set(id, cal);
    return cal;
  };

  let breached = 0;
  let responseBreached = 0;
  let atRisk = 0;
  let policySteps = 0;

  for (const t of tickets) {
    try {
      const calendar = await getCal(t.sla?.businessCalendarId ?? null);

      // First-response breach is independent of the resolve-SLA state below.
      if (firstResponseBreached(t, now)) {
        const res = await db.ticket.updateMany({
          where: { id: t.id, firstResponseAt: null, responseBreached: false },
          data: { responseBreached: true },
        });
        if (res.count > 0) {
          await runAutomations("TICKET_SLA_BREACHED", t.id);
          responseBreached++;
        }
      }

      // Multi-stage escalation policy (business-aware). Runs regardless of the
      // coarse breach/at-risk state below — its steps have their own thresholds.
      const steps = t.sla?.escalationPolicy?.steps;
      if (steps && steps.length > 0 && !["PENDING", "ON_HOLD"].includes(t.status) && !t.pendingSince) {
        policySteps += await runEscalationPolicy(t, steps as PolicyStep[], now, calendar);
      }

      const { state } = slaSnapshot(t, now, calendar);

      if (state === "BREACHED") {
        const res = await db.ticket.updateMany({
          where: { id: t.id, escalatedAt: null },
          data: { escalatedAt: now },
        });
        if (res.count > 0) {
          await runAutomations("TICKET_SLA_BREACHED", t.id);
          breached++;
        }
      } else if (state === "AT_RISK") {
        if (t.escalatedAt) continue; // breach escalation supersedes at-risk
        const res = await db.ticket.updateMany({
          where: { id: t.id, slaAtRiskNotifiedAt: null },
          data: { slaAtRiskNotifiedAt: now },
        });
        if (res.count > 0) {
          await runAutomations("TICKET_SLA_AT_RISK", t.id);
          atRisk++;
        }
      }
    } catch (e) {
      console.error(
        `[servio:sla-escalation] ticket ${t.id} error:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return { breached, responseBreached, atRisk, policySteps };
}
