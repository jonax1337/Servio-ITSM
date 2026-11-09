import { db } from "@/lib/db";
import { isGroupMember } from "@/lib/assignment";
import { hasRole, type Role } from "@/lib/session";

/** The minimal user shape an authorization check needs. */
type ActingUser = { id: string; role: Role | string };
/** The minimal ticket shape an authorization check needs. */
type ActingTicket = { assigneeId?: string | null; groupId?: string | null };

/**
 * Whether `user` may act on `ticket` (comment, forward, merge, resolve, delete, …).
 *
 * - ADMIN / MANAGER may act on ANY ticket.
 * - AGENT may act only on tickets they are assigned to OR whose group they belong
 *   to (GroupMember). An unassigned, un-grouped ticket is actionable by any agent.
 *
 * Pure rule: pass already-loaded user + ticket and a group-membership lookup.
 */
export function mayActOnTicket(
  user: ActingUser,
  ticket: ActingTicket,
  isMember: (groupId: string, userId: string) => boolean,
): boolean {
  if (hasRole(user.role as Role, "MANAGER")) return true;
  // Below MANAGER: only AGENT-level users get here through the requireAgent gate,
  // but guard anyway so a USER can never act even if this is called elsewhere.
  if (!hasRole(user.role as Role, "AGENT")) return false;
  if (ticket.assigneeId && ticket.assigneeId === user.id) return true;
  if (ticket.groupId) return isMember(ticket.groupId, user.id);
  // No group and not the assignee → shared queue, any agent may act.
  return true;
}

/** {@link mayActOnTicket} with the group membership read from the database (only for non-managers on a grouped ticket). */
export async function canActOnTicket(user: ActingUser, ticket: ActingTicket): Promise<boolean> {
  const member = ticket.groupId && !hasRole(user.role as Role, "MANAGER") ? await isGroupMember(ticket.groupId, user.id) : false;
  return mayActOnTicket(user, ticket, () => member);
}

/**
 * Assertion form of {@link canActOnTicket}. Returns `true` when allowed, `false`
 * when not — callers `return`/short-circuit on a `false`, matching the silent-abort
 * style of the ticket actions (which return void on an unauthorized request).
 */
export async function assertCanActOnTicket(user: ActingUser, ticket: ActingTicket): Promise<boolean> {
  return canActOnTicket(user, ticket);
}

/**
 * A ticket filed through the REST API by this very account: the account is its
 * requester and the source is API (an integration filing its own alert), or the
 * account's `Created via API` audit entry says it filed it on someone's behalf.
 * Pure rule; `createdViaApi` is the audit lookup's answer.
 */
export function filedOwnApiTicket(
  user: { id: string },
  ticket: { requesterId?: string | null; source?: string | null },
  createdViaApi: boolean,
): boolean {
  return createdViaApi || (ticket.requesterId === user.id && ticket.source === "API");
}

/**
 * Whether `user` may resolve (or close, cancel) `ticket`: whoever may act on it, plus the
 * account that filed it through the API. A monitoring integration must be able to close
 * the alert it opened even when its account is not a member of the group the ticket was
 * routed to. Everything else on the ticket (comments, merges, deletes …) keeps
 * {@link canActOnTicket}.
 */
export async function canResolveTicket(
  user: ActingUser,
  ticket: ActingTicket & { id: number; requesterId?: string | null; source?: string | null },
): Promise<boolean> {
  if (await canActOnTicket(user, ticket)) return true;
  if (!hasRole(user.role as Role, "AGENT")) return false;
  if (filedOwnApiTicket(user, ticket, false)) return true;
  const created = await db.auditLog.findFirst({
    where: { entity: "Ticket", entityId: String(ticket.id), action: "CREATE", userId: user.id, summary: { startsWith: "Created via API" } },
    select: { id: true },
  });
  return filedOwnApiTicket(user, ticket, created !== null);
}
