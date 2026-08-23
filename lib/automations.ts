import { db } from "@/lib/db";
import { writeAudit, notify } from "@/lib/audit";
import { getAutomationUserId } from "@/lib/system-user";
import { statusChangeData, ticketCalendar } from "@/lib/sla";
import { safeWebhookFetch } from "@/lib/safe-fetch";
import { canTransitionConfigured } from "@/lib/workflow";
import { isGroupMember } from "@/lib/assignment";
import { isAgent, type Role } from "@/lib/session";
import { PRIORITIES, TICKET_STATUSES, ticketRef } from "@/lib/constants";
import { parseJson, type Condition, type AutomationAction } from "@/lib/automation-defs";

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

// Automations run as a dedicated, fully-privileged system actor: the rules are
// admin-authored infrastructure, so transition role gates (which exist to fence
// off *human* actors) don't apply — but the lifecycle itself (allowed pairs)
// still does, via canTransitionConfigured below.
const AUTOMATION_ROLE: Role = "ADMIN";

/**
 * True when `userId` is an active agent (AGENT or above) belonging to `groupId`.
 * Mirrors the console's assignee invariant so a corrupt rule can't route a
 * ticket to an inactive user, a plain end-user, or a non-member.
 */
async function isActiveGroupAgent(groupId: string, userId: string): Promise<boolean> {
  const m = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { user: { select: { role: true, isActive: true } } },
  });
  return !!m && m.user.isActive && isAgent(m.user.role as Role);
}

type Trigger =
  | "TICKET_CREATED"
  | "TICKET_UPDATED"
  | "TICKET_SLA_AT_RISK"
  | "TICKET_SLA_BREACHED";

async function loadTicket(id: number) {
  return db.ticket.findUnique({
    where: { id },
    include: { requester: true, group: true, assignee: true, sla: { select: { businessCalendarId: true } } },
  });
}
type TicketRow = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

function fieldValue(t: TicketRow, field: string): string | null {
  if (field === "requesterVip") return t.requester?.isVip ? "true" : "false";
  const v = (t as unknown as Record<string, unknown>)[field];
  return v == null ? null : String(v);
}

function evalCondition(t: TicketRow, c: Condition): boolean {
  const v = fieldValue(t, c.field);
  const target = c.value ?? "";
  switch (c.op) {
    case "eq": return (v ?? "") === target;
    case "ne": return (v ?? "") !== target;
    case "contains": return (v ?? "").toLowerCase().includes(target.toLowerCase());
    case "empty": return !v;
    case "not_empty": return !!v;
    default: return false;
  }
}

/**
 * Run all active automation rules for a trigger against a ticket.
 * Uses direct db writes (never the user-facing actions) so it can't recurse.
 */
export async function runAutomations(trigger: Trigger, ticketId: number) {
  const rules = await db.automationRule.findMany({
    where: { trigger, isActive: true },
    orderBy: { order: "asc" },
  });
  if (rules.length === 0) return;

  let t = await loadTicket(ticketId);
  if (!t) return;

  for (const rule of rules) {
    const conds = parseJson<Condition[]>(rule.conditions, []);
    const match =
      conds.length === 0
        ? true
        : rule.matchType === "ANY"
          ? conds.some((c) => evalCondition(t!, c))
          : conds.every((c) => evalCondition(t!, c));
    if (!match) continue;

    const actions = parseJson<AutomationAction[]>(rule.actions, []);
    const patch: Record<string, unknown> = {};
    // Set to the assignee id when the `assign` action actually lands one, so we
    // can emit the same ASSIGNED notification the console does after the write.
    let assignedUserId: string | null = null;

    for (const a of actions) {
      switch (a.type) {
        case "set_status": {
          // Route through the configured lifecycle (built-in map + admin
          // overrides). A corrupt rule must never write a junk status or force a
          // disallowed transition — skip + log instead. On an allowed move apply
          // the SAME SLA/resolution side-effects as the console.
          const next = a.value;
          if (!next || !TICKET_STATUSES.includes(next as (typeof TICKET_STATUSES)[number])) break;
          if (!(await canTransitionConfigured("TICKET", t.status, next, AUTOMATION_ROLE))) {
            await writeAudit({ userId: null, action: "AUTOMATION", entity: "Ticket", entityId: ticketId, summary: `Automation "${rule.name}" skipped disallowed status transition ${t.status} → ${next}` });
            break;
          }
          patch.status = next;
          Object.assign(patch, statusChangeData(t, next, new Date(), await ticketCalendar(t)));
          break;
        }
        case "set_priority":
          // Reject junk priorities from a corrupt/hand-edited rule.
          if (a.value && PRIORITIES.includes(a.value as (typeof PRIORITIES)[number])) {
            patch.priority = a.value;
          }
          break;
        case "assign": {
          // Clearing the assignee is always fine.
          if (!a.value) { patch.assigneeId = null; assignedUserId = null; break; }
          // Otherwise enforce the console invariant: the assignee must be an
          // active agent in the ticket's (effective) group. With no group,
          // require at least that they're an active agent — never a plain user.
          const targetGroupId =
            (patch.groupId as string | null | undefined) !== undefined
              ? (patch.groupId as string | null)
              : t.groupId;
          let ok: boolean;
          if (targetGroupId) {
            ok = await isActiveGroupAgent(targetGroupId, a.value);
          } else {
            const u = await db.user.findUnique({ where: { id: a.value }, select: { role: true, isActive: true } });
            ok = !!u && u.isActive && isAgent(u.role as Role);
          }
          if (ok) {
            patch.assigneeId = a.value;
            assignedUserId = a.value;
          }
          break;
        }
        case "set_group": {
          const next = a.value || null;
          if (next) {
            // A corrupt rule must not route to a non-existent group.
            const g = await db.group.findUnique({ where: { id: next }, select: { id: true } });
            if (!g) break;
          }
          patch.groupId = next;
          // Re-routing to a group the pending/current assignee isn't in clears
          // the assignee, matching the console.
          const pendingAssignee =
            (patch.assigneeId as string | null | undefined) !== undefined
              ? (patch.assigneeId as string | null)
              : t.assigneeId;
          if (next && pendingAssignee && !(await isGroupMember(next, pendingAssignee))) {
            patch.assigneeId = null;
            assignedUserId = null;
          }
          break;
        }
        case "escalate": {
          const i = PRIORITY_ORDER.indexOf(t.priority as (typeof PRIORITY_ORDER)[number]);
          // Unknown/corrupt priority (indexOf → -1): keep the current value
          // rather than silently de-escalating to LOW.
          if (i >= 0) patch.priority = PRIORITY_ORDER[Math.min(i + 1, PRIORITY_ORDER.length - 1)];
          break;
        }
        case "major_incident":
          patch.isMajorIncident = true;
          patch.priority = "CRITICAL";
          break;
        case "notify":
          if (a.value) await notify(a.value, { type: "AUTOMATION", title: `Automation: ${rule.name}`, body: t.title, entity: "Ticket", entityId: String(ticketId) });
          break;
        case "notify_group": {
          // Notify every active agent in the ticket's assigned group.
          if (t.groupId) {
            const members = await db.groupMember.findMany({
              where: { groupId: t.groupId, user: { isActive: true } },
              select: { userId: true },
            });
            for (const m of members) {
              await notify(m.userId, { type: "AUTOMATION", title: `Automation: ${rule.name}`, body: t.title, entity: "Ticket", entityId: String(ticketId) });
            }
          }
          break;
        }
        case "webhook": {
          // Best-effort outbound POST through the SSRF guard (rejects private /
          // loopback / link-local / metadata hosts and refuses redirects). Never
          // let a bad/blocked/slow URL break the rule run — swallow all errors.
          if (a.value) {
            try {
              await safeWebhookFetch(a.value, {
                ticketId: t.id,
                ref: ticketRef(t.id, t.prefix || t.type),
                title: t.title,
                status: t.status,
                priority: t.priority,
                group: t.group?.name ?? null,
                assignee: t.assignee?.name ?? null,
              });
            } catch {
              /* best-effort — ignore SSRF-block / network / timeout errors */
            }
          }
          break;
        }
        case "internal_note": {
          const authorId = await getAutomationUserId();
          await db.ticketComment.create({ data: { ticketId, authorId, isInternal: true, body: a.value || `Automation "${rule.name}" ran.` } });
          break;
        }
      }
    }

    if (Object.keys(patch).length > 0) {
      await db.ticket.update({ where: { id: ticketId }, data: patch });
      t = await loadTicket(ticketId);
      if (!t) return;
      // Emit the same assignment notification the console does — but only if the
      // assignee actually stuck through the write (a later set_group in the same
      // rule may have cleared it) and the ticket's assignee is now that user.
      if (assignedUserId && t.assigneeId === assignedUserId) {
        await notify(assignedUserId, { type: "ASSIGNED", title: "Ticket assigned to you", body: t.title, entity: "Ticket", entityId: String(ticketId) });
      }
    }

    await db.automationRule.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    await writeAudit({ userId: null, action: "AUTOMATION", entity: "Ticket", entityId: ticketId, summary: `Automation "${rule.name}" applied` });
  }
}
