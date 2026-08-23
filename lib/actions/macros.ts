"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, isAgent, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { canActOnTicket } from "@/lib/authz";
import { isGroupMember, autoAssignTicket } from "@/lib/assignment";
import { statusChangeData, ticketCalendar } from "@/lib/sla";
import { canTransitionConfigured } from "@/lib/workflow";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { deliverTicketReply } from "@/lib/actions/tickets";
import { TICKET_STATUSES, PRIORITIES } from "@/lib/constants";

/**
 * A macro is an ordered list of actions applied to a ticket in one click
 * (Freshservice / Zendesk "canned responses & workflows"). Each action is a
 * `{ type, value }` pair; `value` is a string interpreted per-type:
 *   set_status   → a TICKET_STATUSES value
 *   set_priority → a PRIORITIES value
 *   assign       → a User id (agent) or "" to unassign
 *   set_group    → a Group id or "" to un-route
 *   add_reply    → public reply body (plaintext, becomes an agent comment)
 *   add_comment  → internal note body (plaintext, private comment)
 *
 * Actions are stored as JSON in Macro.actions (mirrors SavedView.filters /
 * Dashboard.layout: a `String` column with a `// JSON` comment on the schema).
 */
// NOTE: this is a "use server" module — every export must be an async function.
// So the action-type tuple/types live as module-locals here (the client editor in
// components/settings/macro-manager.tsx keeps its own copy of the tuple).
const MACRO_ACTION_TYPES = [
  "set_status",
  "set_priority",
  "assign",
  "set_group",
  "add_reply",
  "add_comment",
] as const;
type MacroActionType = (typeof MACRO_ACTION_TYPES)[number];

type MacroAction = { type: MacroActionType; value: string };

const actionSchema = z.object({
  type: z.enum(MACRO_ACTION_TYPES),
  value: z.string().default(""),
});

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().optional().default(""),
  isShared: z.boolean().default(false),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(20),
});

export type MacroState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

/** Live-DB actor gate: any active agent+ may manage their OWN macros; only a
 *  MANAGER+ may create/edit SHARED macros. */
async function requireAgentUser() {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) return null;
  return me;
}

/** Validate the per-type value up front so a bad status/priority never reaches
 *  applyMacro (which would silently skip it). Reused by create + update. */
function validateActions(actions: MacroAction[]): string | null {
  for (const a of actions) {
    if (a.type === "set_status" && !TICKET_STATUSES.includes(a.value as (typeof TICKET_STATUSES)[number])) {
      return `"${a.value}" is not a valid status.`;
    }
    if (a.type === "set_priority" && !PRIORITIES.includes(a.value as (typeof PRIORITIES)[number])) {
      return `"${a.value}" is not a valid priority.`;
    }
    if ((a.type === "add_reply" || a.type === "add_comment") && !a.value.trim()) {
      return "Reply / note actions need some text.";
    }
  }
  return null;
}

function parse(formData: FormData) {
  // The client posts the full ordered action list as a single JSON field.
  let actions: unknown = [];
  try {
    actions = JSON.parse(String(formData.get("actions") ?? "[]"));
  } catch {
    actions = [];
  }
  return upsertSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    isShared: formData.get("isShared") === "true" || formData.get("isShared") === "on",
    actions,
  });
}

export async function createMacro(_prev: MacroState, formData: FormData): Promise<MacroState> {
  const me = await requireAgentUser();
  if (!me) return { error: "You need agent access to manage macros." };
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  // Only MANAGER+ may publish a shared macro; an agent's macro is always personal.
  const isShared = d.isShared && hasRole(me.role as Role, "MANAGER");

  const invalid = validateActions(d.actions);
  if (invalid) return { error: invalid };

  const macro = await db.macro.create({
    data: {
      name: d.name,
      description: d.description || null,
      actions: JSON.stringify(d.actions),
      // A shared macro has no personal owner scope; a personal one is bound to me.
      ownerId: isShared ? null : me.id,
      isShared,
    },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Macro", entityId: macro.id, summary: `Created macro "${macro.name}"` });
  revalidatePath("/settings/macros");
  return { ok: true };
}

export async function updateMacro(_prev: MacroState, formData: FormData): Promise<MacroState> {
  const me = await requireAgentUser();
  if (!me) return { error: "You need agent access to manage macros." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing macro id." };
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  const existing = await db.macro.findUnique({ where: { id }, select: { ownerId: true, isShared: true } });
  if (!existing) return { error: "That macro no longer exists." };
  if (!canManageMacro(me, existing)) return { error: "You can only edit your own macros." };

  const invalid = validateActions(d.actions);
  if (invalid) return { error: invalid };

  // Publishing (personal → shared) or keeping shared requires MANAGER+.
  const canShare = hasRole(me.role as Role, "MANAGER");
  const isShared = d.isShared && canShare;

  await db.macro.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description || null,
      actions: JSON.stringify(d.actions),
      isShared,
      // A macro that becomes shared drops its personal owner; one made personal
      // is (re)bound to the editor.
      ownerId: isShared ? null : (existing.ownerId ?? me.id),
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Macro", entityId: id, summary: `Updated macro "${d.name}"` });
  revalidatePath("/settings/macros");
  return { ok: true };
}

export async function deleteMacro(formData: FormData) {
  const me = await requireAgentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const macro = await db.macro.findUnique({ where: { id }, select: { name: true, ownerId: true, isShared: true } });
  if (!macro) return;
  if (!canManageMacro(me, macro)) return;
  await db.macro.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Macro", entityId: id, summary: `Deleted macro "${macro.name}"` });
  revalidatePath("/settings/macros");
}

/** Who may edit/delete a macro: the personal owner, or a MANAGER+ for a shared one. */
function canManageMacro(
  me: { id: string; role: string },
  macro: { ownerId: string | null; isShared: boolean },
): boolean {
  if (macro.isShared) return hasRole(me.role as Role, "MANAGER");
  return macro.ownerId === me.id;
}

/**
 * Apply a macro's ordered actions to a ticket in one shot. RBAC:
 *   - the actor must be able to act on THIS ticket (canActOnTicket), and
 *   - the macro must be visible to them (their own personal macro OR a shared one).
 * Enum values, the configured status lifecycle and group membership are all
 * re-validated here (a macro row could have drifted from constants) — an invalid
 * step is skipped rather than aborting the whole macro.
 *
 * The writes are done directly here (never via tickets.ts) so this stays the
 * single owner of the macro slice, mirroring how updateTicketField guards.
 */
export async function applyMacro(formData: FormData) {
  const me = await requireAgentUser();
  if (!me) return { error: "You need agent access to run macros." };

  const ticketId = Number(formData.get("ticketId"));
  const macroId = String(formData.get("macroId") ?? "");
  if (!Number.isFinite(ticketId) || !macroId) return { error: "Missing ticket or macro." };

  const macro = await db.macro.findUnique({ where: { id: macroId } });
  if (!macro) return { error: "That macro no longer exists." };
  // Visibility: personal macros are the owner's only; shared macros are for all agents.
  if (!macro.isShared && macro.ownerId !== me.id) return { error: "You can't use that macro." };

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    // The clock fields (responseDueAt … pausedMs) are needed by statusChangeData
    // so a status action pauses/resumes the SLA correctly; the SLA carries the
    // business calendar for pause shifts in working time.
    select: {
      id: true, title: true, type: true, requesterId: true,
      assigneeId: true, groupId: true, status: true,
      responseDueAt: true, resolveDueAt: true, dueAt: true, pendingSince: true, pausedMs: true,
      sla: { select: { businessCalendarId: true } },
    },
  });
  if (!ticket) return { error: "Ticket not found." };
  // Per-ticket authorization — the assignee, a group member, or a MANAGER+.
  if (!(await canActOnTicket(me, ticket))) return { error: "You can't act on this ticket." };

  let actions: MacroAction[] = [];
  try {
    const raw = JSON.parse(macro.actions) as unknown;
    if (Array.isArray(raw)) actions = raw.filter((a): a is MacroAction => !!a && typeof a === "object" && "type" in a);
  } catch {
    return { error: "This macro is malformed." };
  }

  // Accumulate field changes into one ticket update; comments/replies are created
  // separately. `patch` mirrors the fields updateTicketField writes.
  const patch: Record<string, unknown> = {};
  let touchedGroup = false;
  const summaryParts: string[] = [];
  // Public replies created by this macro. Their outbound email + notifications are
  // fired AFTER the ticket field patch lands (so first-response stamping sees the
  // final state), via the same deliverTicketReply pipeline as addTicketComment.
  const publicReplies: { id: string; body: string; bodyHtml: string }[] = [];

  for (const a of actions) {
    switch (a.type) {
      case "set_status": {
        if (!TICKET_STATUSES.includes(a.value as (typeof TICKET_STATUSES)[number])) break;
        // Enforce the configured lifecycle + role, same as updateTicketField.
        if (!(await canTransitionConfigured("TICKET", ticket.status, a.value, me.role as Role))) break;
        Object.assign(patch, { status: a.value }, statusChangeData(ticket, a.value, new Date(), await ticketCalendar(ticket)));
        summaryParts.push(`status → ${a.value}`);
        break;
      }
      case "set_priority": {
        if (!PRIORITIES.includes(a.value as (typeof PRIORITIES)[number])) break;
        patch.priority = a.value;
        summaryParts.push(`priority → ${a.value}`);
        break;
      }
      case "assign": {
        const v = a.value || null;
        if (v) {
          const exists = await db.user.findUnique({ where: { id: v }, select: { id: true } });
          if (!exists) break;
          // Assignee must belong to the ticket's (possibly newly-set) group.
          const gid = (patch.groupId as string | null | undefined) ?? ticket.groupId;
          if (gid && !(await isGroupMember(gid, v))) break;
        }
        patch.assigneeId = v;
        summaryParts.push(v ? "assigned" : "unassigned");
        break;
      }
      case "set_group": {
        const v = a.value || null;
        if (v) {
          const exists = await db.group.findUnique({ where: { id: v }, select: { id: true } });
          if (!exists) break;
        }
        patch.groupId = v;
        touchedGroup = true;
        // Re-routing to a group the assignee isn't in clears the assignee.
        if (v) {
          const assignee = (patch.assigneeId as string | null | undefined) ?? ticket.assigneeId;
          if (assignee && !(await isGroupMember(v, assignee))) patch.assigneeId = null;
        }
        summaryParts.push(v ? "re-grouped" : "un-grouped");
        break;
      }
      case "add_reply":
      case "add_comment": {
        const isInternal = a.type === "add_comment";
        const bodyHtml = sanitizeCommentHtml(a.value);
        const body = htmlToText(bodyHtml).trim() || a.value.trim();
        if (!body) break;
        const comment = await db.ticketComment.create({
          data: { ticketId, authorId: me.id, body, bodyHtml, isInternal },
        });
        // Internal notes stay internal (no requester email). Public replies are
        // delivered after the ticket update below so each one emails exactly once.
        if (!isInternal) publicReplies.push({ id: comment.id, body, bodyHtml });
        summaryParts.push(isInternal ? "added a note" : "added a reply");
        break;
      }
    }
  }

  const hasFieldChange = Object.keys(patch).length > 0;
  if (hasFieldChange) {
    await db.ticket.update({ where: { id: ticketId }, data: patch });
  } else {
    // Reply/note-only macro: still bump updatedAt so the ticket resurfaces
    // (Prisma's @updatedAt already handles the field-change path above).
    await db.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  }
  // If the macro re-grouped and left the ticket unassigned, let auto-assign route it.
  if (touchedGroup && patch.groupId && !patch.assigneeId) {
    await autoAssignTicket(ticketId);
  }

  // A public `add_reply` must go out exactly like a hand-typed public reply:
  // requester email (+ Cc participants), watcher/mention notifications and
  // first-response SLA stamping — the shared deliverTicketReply pipeline. The
  // macro has no composer To/Cc/Bcc, so recipients fall back to requester +
  // participants. Fetch the (updated) requester once for all replies.
  if (publicReplies.length) {
    const full = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, title: true, type: true, status: true, requesterId: true, requester: { select: { email: true, name: true } } },
    });
    if (full) {
      for (const r of publicReplies) {
        await deliverTicketReply({
          ticket: full,
          comment: { id: r.id },
          author: { id: me.id, email: me.email, name: me.name ?? me.email, role: me.role },
          body: r.body,
          bodyHtml: r.bodyHtml,
          isInternal: false,
        });
      }
    }
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    summary: `Applied macro "${macro.name}"${summaryParts.length ? ` (${summaryParts.join(", ")})` : ""}`,
  });

  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}
