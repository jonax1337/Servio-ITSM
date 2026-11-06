"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { canActOnTicket } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { STATUS_INCIDENT_IMPACTS, STATUS_INCIDENT_STATES } from "@/lib/constants";
import {
  PUBLISH_REFUSAL,
  canPublishStatusIncident,
  publicCopyRefusal,
  publishedAtFor,
  resolvedAtFor,
} from "@/lib/status-rules";

/** `id` carries the created incident back to the caller (create only). */
export type StatusActionResult = ActionResult & { id?: string };

const NOT_AUTHORISED = "Not authorised.";
const NOT_FOUND = "Status incident not found.";
const NOT_LINKABLE = "You can't link a ticket you can't act on.";
const TICKET_TAKEN = "That ticket is already linked to another status incident.";

const fail = (error: string): StatusActionResult => ({ ok: false, error });

const fieldsSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters.").max(140, "Title is too long."),
  summary: z.string().trim().max(2000, "Summary is too long."),
  impact: z.enum(STATUS_INCIDENT_IMPACTS),
});

const stateSchema = z.enum(STATUS_INCIDENT_STATES, { error: "Pick a valid state." });

const incidentIdSchema = z.string().min(1);
const visibilitySchema = z.enum(["true", "false"]);

const updateBodySchema = z
  .string()
  .trim()
  .min(3, "Write at least a few words for the update.")
  .max(4000, "The update is too long.");

function readIncidentId(formData: FormData): string | null {
  const parsed = incidentIdSchema.safeParse(formData.get("incidentId"));
  return parsed.success ? parsed.data : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function readFields(formData: FormData) {
  return fieldsSchema.safeParse({
    title: formData.get("title") ?? "",
    summary: formData.get("summary") ?? "",
    impact: formData.get("impact"),
  });
}

/** The ticket picker's "no ticket" value (see ComboField `includeNone`). */
const NO_TICKET = "none";

/** Ticket number from a form field ("42", "INC-0042"); `null` when blank, `undefined` when unreadable. */
function readTicketId(formData: FormData): number | null | undefined {
  const raw = String(formData.get("ticketId") ?? "").trim();
  if (!raw || raw === NO_TICKET) return null;
  const digits = raw.match(/^[A-Za-z]*-?0*(\d+)$/)?.[1];
  return digits ? Number(digits) : undefined;
}

/**
 * Resolve the ticket link. `null` clears it. A new link must be a major incident the
 * actor may act on: portal users can join the linked ticket, so linking is a disclosure.
 * Keeping the current link (`currentTicketId`) is always allowed.
 */
async function resolveTicketLink(
  formData: FormData,
  me: { id: string; role: string },
  currentTicketId: number | null = null,
): Promise<{ ticketId: number | null } | { error: string }> {
  const ticketId = readTicketId(formData);
  if (ticketId === undefined) return { error: "Enter the linked ticket as a number, e.g. 42." };
  if (ticketId === null || ticketId === currentTicketId) return { ticketId };
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { assigneeId: true, groupId: true, isMajorIncident: true },
  });
  if (!ticket) return { error: `Ticket ${ticketId} does not exist.` };
  if (!(await canActOnTicket(me, ticket))) return { error: NOT_LINKABLE };
  if (!ticket.isMajorIncident) return { error: `Ticket ${ticketId} is not a major incident.` };
  return { ticketId };
}

/** Affected services from the form's repeated `serviceId` field; every id must exist. */
async function resolveServiceIds(formData: FormData): Promise<{ serviceIds: string[] } | { error: string }> {
  const ids = [...new Set(formData.getAll("serviceId").map(String).filter(Boolean))];
  if (ids.length === 0) return { serviceIds: [] };
  const found = await db.service.count({ where: { id: { in: ids } } });
  return found === ids.length ? { serviceIds: ids } : { error: "One of the selected services no longer exists." };
}

function revalidateStatus(id?: string) {
  revalidatePath("/status");
  if (id) revalidatePath(`/status/${id}`);
  revalidatePath("/portal/status");
  revalidatePath("/portal/new");
}

const errorCode = (e: unknown) => (e as { code?: string })?.code;

/** AGENT+ drafts an incident; publishing it right away needs MANAGER+. */
export async function createStatusIncident(formData: FormData): Promise<StatusActionResult> {
  const me = await requireAgentUser();
  if (!me) return fail(NOT_AUTHORISED);

  const fields = readFields(formData);
  if (!fields.success) return fail(firstIssue(fields.error));
  const state = stateSchema.safeParse(formData.get("state"));
  if (!state.success) return fail(firstIssue(state.error));
  const firstUpdate = String(formData.get("updateBody") ?? "").trim();
  if (firstUpdate) {
    const body = updateBodySchema.safeParse(firstUpdate);
    if (!body.success) return fail(firstIssue(body.error));
  }

  const publish = formData.get("isPublic") === "on";
  if (publish && !canPublishStatusIncident(me.role)) return fail(PUBLISH_REFUSAL);

  const ticket = await resolveTicketLink(formData, me);
  if ("error" in ticket) return fail(ticket.error);
  const services = await resolveServiceIds(formData);
  if ("error" in services) return fail(services.error);

  const now = new Date();
  try {
    const created = await db.statusIncident.create({
      data: {
        title: fields.data.title,
        summary: fields.data.summary || null,
        impact: fields.data.impact,
        state: state.data,
        isPublic: publish,
        publishedAt: publishedAtFor(publish, null, now),
        resolvedAt: resolvedAtFor(state.data, null, now),
        ticketId: ticket.ticketId,
        services: { create: services.serviceIds.map((serviceId) => ({ serviceId })) },
        updates: firstUpdate ? { create: { state: state.data, body: firstUpdate, authorId: me.id } } : undefined,
      },
      select: { id: true },
    });
    await writeAudit({
      userId: me.id,
      action: "CREATE",
      entity: "StatusIncident",
      entityId: created.id,
      summary: `Created ${publish ? "public" : "draft"} status incident "${fields.data.title}"`,
    });
    revalidateStatus(created.id);
    return { ok: true, id: created.id };
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(TICKET_TAKEN);
    throw e;
  }
}

/** AGENT+ edits the incident's descriptive fields, affected services and ticket link; a public incident's wording needs MANAGER+. */
export async function updateStatusIncident(formData: FormData): Promise<StatusActionResult> {
  const me = await requireAgentUser();
  if (!me) return fail(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "");
  if (!id) return fail(NOT_FOUND);

  const fields = readFields(formData);
  if (!fields.success) return fail(firstIssue(fields.error));
  const current = await db.statusIncident.findUnique({
    where: { id },
    select: { ticketId: true, title: true, summary: true, impact: true, isPublic: true },
  });
  if (!current) return fail(NOT_FOUND);
  const copyRefusal = publicCopyRefusal(me.role, current, { ...fields.data, summary: fields.data.summary || null });
  if (copyRefusal) return fail(copyRefusal);
  const ticket = await resolveTicketLink(formData, me, current.ticketId);
  if ("error" in ticket) return fail(ticket.error);
  const services = await resolveServiceIds(formData);
  if ("error" in services) return fail(services.error);

  try {
    await db.statusIncident.update({
      where: { id },
      data: {
        title: fields.data.title,
        summary: fields.data.summary || null,
        impact: fields.data.impact,
        ticketId: ticket.ticketId,
        services: { deleteMany: {}, create: services.serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
  } catch (e) {
    if (errorCode(e) === "P2002") return fail(TICKET_TAKEN);
    if (errorCode(e) === "P2025") return fail(NOT_FOUND);
    throw e;
  }
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "StatusIncident", entityId: id, summary: `Edited status incident "${fields.data.title}"` });
  revalidateStatus(id);
  return { ok: true, id };
}

/** AGENT+ posts a timeline update; its state becomes the incident's state. */
export async function postStatusIncidentUpdate(formData: FormData): Promise<StatusActionResult> {
  const me = await requireAgentUser();
  if (!me) return fail(NOT_AUTHORISED);
  const incidentId = readIncidentId(formData);
  if (!incidentId) return fail(NOT_FOUND);
  const state = stateSchema.safeParse(formData.get("state"));
  if (!state.success) return fail(firstIssue(state.error));
  const body = updateBodySchema.safeParse(formData.get("body") ?? "");
  if (!body.success) return fail(firstIssue(body.error));

  const incident = await db.statusIncident.findUnique({ where: { id: incidentId }, select: { title: true, resolvedAt: true } });
  if (!incident) return fail(NOT_FOUND);

  await db.$transaction([
    db.statusIncidentUpdate.create({ data: { incidentId, state: state.data, body: body.data, authorId: me.id } }),
    db.statusIncident.update({
      where: { id: incidentId },
      data: { state: state.data, resolvedAt: resolvedAtFor(state.data, incident.resolvedAt, new Date()) },
    }),
  ]);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "StatusIncident", entityId: incidentId, summary: `Posted a ${state.data} update on "${incident.title}"` });
  revalidateStatus(incidentId);
  return { ok: true, id: incidentId };
}

/** MANAGER+ publishes a draft or retracts a public incident (`isPublic` = "true" | "false"). */
export async function setStatusIncidentVisibility(formData: FormData): Promise<StatusActionResult> {
  const me = await requireAgentUser();
  if (!me) return fail(NOT_AUTHORISED);
  if (!canPublishStatusIncident(me.role)) return fail(PUBLISH_REFUSAL);
  const incidentId = readIncidentId(formData);
  const visibility = visibilitySchema.safeParse(formData.get("isPublic"));
  if (!incidentId) return fail(NOT_FOUND);
  if (!visibility.success) return fail("Invalid visibility.");
  const isPublic = visibility.data === "true";

  const incident = await db.statusIncident.findUnique({ where: { id: incidentId }, select: { title: true, publishedAt: true } });
  if (!incident) return fail(NOT_FOUND);

  await db.statusIncident.update({
    where: { id: incidentId },
    data: { isPublic, publishedAt: publishedAtFor(isPublic, incident.publishedAt, new Date()) },
  });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "StatusIncident",
    entityId: incidentId,
    summary: `${isPublic ? "Published" : "Retracted"} status incident "${incident.title}"`,
  });
  revalidateStatus(incidentId);
  return { ok: true, id: incidentId };
}

/** MANAGER+ deletes an incident together with its timeline. */
export async function deleteStatusIncident(formData: FormData): Promise<StatusActionResult> {
  const me = await requireAgentUser();
  if (!me) return fail(NOT_AUTHORISED);
  if (!canPublishStatusIncident(me.role)) return fail(PUBLISH_REFUSAL);
  const incidentId = readIncidentId(formData);
  if (!incidentId) return fail(NOT_FOUND);

  const incident = await db.statusIncident.findUnique({ where: { id: incidentId }, select: { title: true } });
  if (!incident) return fail(NOT_FOUND);

  await db.statusIncident.delete({ where: { id: incidentId } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "StatusIncident", entityId: incidentId, summary: `Deleted status incident "${incident.title}"` });
  revalidateStatus();
  return { ok: true };
}
