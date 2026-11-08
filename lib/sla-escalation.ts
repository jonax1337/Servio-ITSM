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
import { currentOnCall, type OnCallUser } from "@/lib/oncall";
import { pickOnCallAssignee } from "@/lib/oncall-rules";
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
//   BUMP_PRIORITY (raise to bumpToPriority), NOTIFY_ONCALL / REASSIGN_ONCALL
//   (whoever is on call for the ticket's group; the group is notified instead
//   when nobody is). Business-hours calendars, when
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

/** A notification decided while planning a step; sent only after the step's marker is written. */
type EscalationNotice = { userId: string; title: string; body: string; percent: number };

async function sendNotices(ticketId: number, notices: EscalationNotice[]) {
  for (const { userId, title, body, percent } of notices) {
    await notify(userId, {
      type: "SLA_ESCALATION",
      title,
      body,
      entity: "Ticket",
      entityId: String(ticketId),
      email: { kind: "SLA_ESCALATION", percent },
    });
  }
}

/** The notices that tell every active agent in a group. */
async function groupNotices(groupId: string, title: string, body: string, percent: number): Promise<EscalationNotice[]> {
  const members = await db.groupMember.findMany({
    where: { groupId, user: { isActive: true } },
    select: { userId: true },
  });
  return members.map((m) => ({ userId: m.userId, title, body, percent }));
}

const onCallNames = (users: OnCallUser[]) => users.map((u) => u.name ?? u.email).join(", ");

/** NOTIFY_ONCALL: tell whoever is on call for the ticket's group, else the group itself. */
async function planOnCallNotice(
  ticketId: number,
  groupId: string | null,
  thresholdPercent: number,
  onCall: OnCallUser[],
): Promise<{ summary: string; notices: EscalationNotice[] }> {
  const prefix = `SLA escalation (${thresholdPercent}% elapsed)`;
  const body = `Ticket #${ticketId} reached ${thresholdPercent}% of its SLA.`;
  if (onCall.length > 0) {
    return {
      summary: `${prefix}: notified on-call (${onCallNames(onCall)}).`,
      notices: onCall.map((u) => ({ userId: u.userId, title: "SLA escalation (you are on call)", body, percent: thresholdPercent })),
    };
  }
  if (!groupId) {
    return { summary: `${prefix}: nobody on call and the ticket has no group; nobody notified.`, notices: [] };
  }
  return {
    summary: `${prefix}: nobody on call, notified the group instead.`,
    notices: await groupNotices(groupId, "SLA escalation", body, thresholdPercent),
  };
}

/**
 * Everyone on call for the ticket's group, and who the ticket goes to (null = nobody
 * qualifies). Only on-call people who are members of the group can be assigned: a
 * rotation or override may name any agent, but the console refuses assignees outside
 * the ticket's group.
 */
async function resolveOnCallAssignee(
  groupId: string | null,
  currentAssigneeId: string | null,
): Promise<{ assigneeId: string | null; onCall: OnCallUser[] }> {
  const onCall = groupId ? await currentOnCall(groupId) : [];
  const members = groupId
    ? await db.groupMember.findMany({
        where: { groupId, userId: { in: onCall.map((u) => u.userId) } },
        select: { userId: true },
      })
    : [];
  const memberIds = new Set(members.map((m) => m.userId));
  const assignable = onCall.filter((u) => memberIds.has(u.userId)).map((u) => u.userId);
  return { assigneeId: pickOnCallAssignee(assignable, currentAssigneeId), onCall };
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
    let notices: EscalationNotice[] = [];
    let summary = "";

    switch (step.action) {
      case "NOTIFY": {
        summary = `SLA escalation (${step.thresholdPercent}% elapsed): notified.`;
        const body = `Ticket #${ticket.id} reached ${step.thresholdPercent}% of its SLA.`;
        if (step.targetUserId) notices.push({ userId: step.targetUserId, title: "SLA escalation", body, percent: step.thresholdPercent });
        if (step.targetGroupId) notices.push(...(await groupNotices(step.targetGroupId, "SLA escalation", body, step.thresholdPercent)));
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
      case "NOTIFY_ONCALL": {
        const onCall = curGroupId ? await currentOnCall(curGroupId) : [];
        ({ summary, notices } = await planOnCallNotice(ticket.id, curGroupId, step.thresholdPercent, onCall));
        break;
      }
      case "REASSIGN_ONCALL": {
        const { assigneeId, onCall } = await resolveOnCallAssignee(curGroupId, curAssigneeId);
        if (assigneeId) {
          if (assigneeId !== curAssigneeId) {
            patch.assigneeId = assigneeId;
            curAssigneeId = assigneeId;
          }
          const assignee = onCallNames(onCall.filter((u) => u.userId === assigneeId));
          summary = `SLA escalation (${step.thresholdPercent}% elapsed): assigned to on-call ${assignee}.`;
        } else {
          ({ summary, notices } = await planOnCallNotice(ticket.id, curGroupId, step.thresholdPercent, onCall));
        }
        break;
      }
      case "BUMP_PRIORITY": {
        const target = step.bumpToPriority;
        if (target && PRIORITIES.includes(target as (typeof PRIORITIES)[number])) {
          const curIdx = PRIORITIES.indexOf(curPriority as (typeof PRIORITIES)[number]);
          const tgtIdx = PRIORITIES.indexOf(target as (typeof PRIORITIES)[number]);
          // Only raise, never lower. Deliberately NOT re-priced (unlike every other
          // priority writer): the bump reacts to the running SLA nearing its
          // deadline, and a tighter tier measured from creation would breach at once.
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

    // Persist the durable marker FIRST (idempotency), then notify and apply the mutation.
    await markStepFired(ticket.id, step.id, summary);
    await sendNotices(ticket.id, notices);
    if (Object.keys(patch).length > 0) {
      // A new owner gets their own SLA nudge.
      const data = "assigneeId" in patch ? { ...patch, slaNudgedAt: null } : patch;
      await db.ticket.update({ where: { id: ticket.id }, data });
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
