import { ACTIVE_STATUS_INCIDENT_STATES, STATUS_INCIDENT_IMPACTS } from "@/lib/constants";

/** Roles that may make a status incident public (publish, retract, delete). */
const PUBLISHER_ROLES: readonly string[] = ["MANAGER", "ADMIN"];

export const PUBLISH_REFUSAL = "Only managers can publish or retract a status incident.";

export function canPublishStatusIncident(role: string): boolean {
  return PUBLISHER_ROLES.includes(role);
}

export const PUBLIC_COPY_REFUSAL =
  "Only managers can change the title, summary or impact of a public status incident. Post an update instead.";

type IncidentCopy = { title: string; summary: string | null; impact: string };

/**
 * Agents may keep a public incident current (updates, services, ticket link), but the wording the portal
 * shows is the manager's to approve: the refusal when a non-publisher edits it, otherwise null.
 */
export function publicCopyRefusal(role: string, incident: IncidentCopy & { isPublic: boolean }, next: IncidentCopy): string | null {
  if (!incident.isPublic || canPublishStatusIncident(role)) return null;
  const changed =
    incident.title !== next.title || (incident.summary ?? "") !== (next.summary ?? "") || incident.impact !== next.impact;
  return changed ? PUBLIC_COPY_REFUSAL : null;
}

export function isActiveIncidentState(state: string): boolean {
  return (ACTIVE_STATUS_INCIDENT_STATES as readonly string[]).includes(state);
}

/** `resolvedAt` follows the state: set when resolved (kept if already set), cleared on reopen. */
export function resolvedAtFor(state: string, resolvedAt: Date | null, now: Date): Date | null {
  if (state !== "RESOLVED") return null;
  return resolvedAt ?? now;
}

/** Making an incident public stamps `publishedAt` once; later toggles keep the first value. */
export function publishedAtFor(isPublic: boolean, publishedAt: Date | null, now: Date): Date | null {
  return isPublic ? (publishedAt ?? now) : publishedAt;
}

/** The most severe impact of a set of incidents ("NONE" when empty). */
export function worstImpact(impacts: readonly string[]): string {
  let worst = 0;
  for (const impact of impacts) worst = Math.max(worst, STATUS_INCIDENT_IMPACTS.indexOf(impact as never));
  return STATUS_INCIDENT_IMPACTS[worst];
}

/**
 * Internal note a portal user leaves on the incident ticket when they report being affected.
 * It is the durable "joined" marker: the user is deliberately NOT made a ticket participant,
 * because participants can read the whole ticket thread in the portal and receive its mail.
 */
export const AFFECTED_NOTE = "Reported being affected too (via the status page).";

export const JOIN_REFUSALS = {
  notActive: "This incident is no longer active.",
  noTicket: "This incident can't be joined from here. Please open a request instead.",
  ticketClosed: "The incident ticket has already been closed. Please open a request instead.",
} as const;

/** Why a portal user cannot register as affected by an incident, or null when they can. */
export function joinRefusal(incident: {
  isPublic: boolean;
  state: string;
  ticket: { status: string; isMajorIncident: boolean } | null;
}): string | null {
  if (!incident.isPublic || !isActiveIncidentState(incident.state)) return JOIN_REFUSALS.notActive;
  if (!incident.ticket || !incident.ticket.isMajorIncident) return JOIN_REFUSALS.noTicket;
  if (incident.ticket.status === "CLOSED" || incident.ticket.status === "CANCELLED") return JOIN_REFUSALS.ticketClosed;
  return null;
}
