import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notify, writeAudit } from "@/lib/audit";
import { currentOnCall } from "@/lib/oncall";
import { canActOnTicket } from "@/lib/authz";
import { ACTIVE_STATUS_INCIDENT_STATES, ticketRef } from "@/lib/constants";
import { AFFECTED_NOTE, joinRefusal } from "@/lib/status-rules";

/** The public shape of an incident: everything a portal user may see, nothing internal. */
export type PublicIncident = {
  id: string;
  title: string;
  summary: string | null;
  state: string;
  impact: string;
  startedAt: Date;
  resolvedAt: Date | null;
  services: string[];
  updates: { id: string; state: string; body: string; createdAt: Date }[];
  /** The viewer can register as affected (public, active, open incident ticket). */
  canJoin: boolean;
  /** The viewer already follows the incident's ticket (requester or participant). */
  joined: boolean;
};

/** Active public incidents for the portal banner — one indexed query, minimal columns. */
export function listActivePublicIncidentHeads() {
  return db.statusIncident.findMany({
    where: { isPublic: true, state: { in: [...ACTIVE_STATUS_INCIDENT_STATES] } },
    select: { id: true, title: true, impact: true, state: true },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
}

const publicIncidentSelect = (userId: string) =>
  ({
    id: true,
    title: true,
    summary: true,
    state: true,
    impact: true,
    isPublic: true,
    startedAt: true,
    resolvedAt: true,
    services: { select: { service: { select: { name: true } } } },
    updates: { orderBy: { createdAt: "desc" }, select: { id: true, state: true, body: true, createdAt: true } },
    ticket: {
      select: {
        status: true,
        isMajorIncident: true,
        requesterId: true,
        comments: { where: { authorId: userId, isInternal: true, body: AFFECTED_NOTE }, select: { id: true }, take: 1 },
      },
    },
  }) satisfies Prisma.StatusIncidentSelect;

type PublicIncidentRow = Prisma.StatusIncidentGetPayload<{ select: ReturnType<typeof publicIncidentSelect> }>;

function toPublicIncident(row: PublicIncidentRow, userId: string): PublicIncident {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    state: row.state,
    impact: row.impact,
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt,
    services: row.services.map((s) => s.service.name).sort(),
    updates: row.updates,
    canJoin: joinRefusal(row) === null,
    joined: !!row.ticket && (row.ticket.requesterId === userId || row.ticket.comments.length > 0),
  };
}

/** Public incidents only (`isPublic` is part of every query), as seen by `userId`. */
export async function listPublicIncidents(
  userId: string,
  scope: "active" | "history",
  take: number,
): Promise<PublicIncident[]> {
  const active = scope === "active";
  const rows = await db.statusIncident.findMany({
    where: {
      isPublic: true,
      state: active ? { in: [...ACTIVE_STATUS_INCIDENT_STATES] } : { notIn: [...ACTIVE_STATUS_INCIDENT_STATES] },
    },
    select: publicIncidentSelect(userId),
    orderBy: active ? { startedAt: "desc" } : { resolvedAt: "desc" },
    take,
  });
  return rows.map((row) => toPublicIncident(row, userId));
}

/**
 * Tickets `actor` can link a status incident to: major incidents not yet linked to
 * another status incident, plus the one `currentTicketId` already points at. Mirrors
 * the server's link rule (`canActOnTicket`), so the picker offers nothing it would refuse.
 * Callers must be gated to AGENT+.
 */
export async function listLinkableTickets(actor: { id: string; role: string }, currentTicketId: number | null = null) {
  const tickets = await db.ticket.findMany({
    where: {
      OR: [
        { isMajorIncident: true, statusIncident: null },
        ...(currentTicketId === null ? [] : [{ id: currentTicketId }]),
      ],
    },
    select: { id: true, title: true, type: true, prefix: true, assigneeId: true, groupId: true },
    orderBy: { id: "desc" },
    take: 50,
  });
  const linkable = await Promise.all(tickets.map(async (t) => (t.id === currentTicketId || (await canActOnTicket(actor, t))) && t));
  return linkable.flatMap((t) =>
    t ? [{ value: String(t.id), label: `${ticketRef(t.id, t.prefix || t.type)} · ${t.title}` }] : [],
  );
}

type MajorIncidentTicket = {
  id: number;
  title: string;
  type: string;
  prefix: string | null;
  serviceId: string | null;
  groupId: string | null;
  assigneeId: string | null;
};

/**
 * A ticket became a major incident: make sure a linked NON-public draft status
 * incident exists (idempotent — `ticketId` is unique, so a concurrent second call
 * loses on P2002 and is a no-op).
 */
export async function ensureDraftStatusIncident(ticket: MajorIncidentTicket, actorId: string) {
  const existing = await db.statusIncident.findUnique({ where: { ticketId: ticket.id }, select: { id: true } });
  if (existing) return;
  let incidentId: string;
  try {
    const created = await db.statusIncident.create({
      data: {
        title: ticket.title,
        impact: "MAJOR",
        isPublic: false,
        ticketId: ticket.id,
        services: ticket.serviceId ? { create: { serviceId: ticket.serviceId } } : undefined,
      },
      select: { id: true },
    });
    incidentId = created.id;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return;
    throw e;
  }
  await writeAudit({
    userId: actorId,
    action: "CREATE",
    entity: "StatusIncident",
    entityId: incidentId,
    summary: `Drafted a status incident for major incident ${ticketRef(ticket.id, ticket.prefix || ticket.type)}`,
  });
}

/** Tell whoever is on call for the ticket's team that a major incident was declared. */
export async function notifyOnCallOfMajorIncident(ticket: MajorIncidentTicket, actorId: string) {
  if (!ticket.groupId) return;
  const onCall = await currentOnCall(ticket.groupId);
  const recipients = onCall.filter((u) => u.userId !== actorId && u.userId !== ticket.assigneeId);
  await Promise.all(
    recipients.map((u) =>
      notify(u.userId, {
        type: "MAJOR_INCIDENT",
        title: "Major Incident declared - you are on call",
        body: ticket.title,
        entity: "Ticket",
        entityId: String(ticket.id),
      }),
    ),
  );
}
