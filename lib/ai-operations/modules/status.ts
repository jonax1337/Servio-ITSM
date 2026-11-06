import { z } from "zod";
import { db } from "@/lib/db";
import {
  createStatusIncident,
  postStatusIncidentUpdate,
  setStatusIncidentVisibility,
  updateStatusIncident,
} from "@/lib/actions/status-incidents";
import { ACTIVE_STATUS_INCIDENT_STATES, STATUS_INCIDENT_IMPACTS, STATUS_INCIDENT_STATES, ticketRef } from "@/lib/constants";
import { PUBLISH_REFUSAL, canPublishStatusIncident } from "@/lib/status-rules";
import type { AiOperation } from "../types";
import { actionRefusal, err, fromActionResult, ok, str, toFormData } from "../helpers";

/**
 * Status page incidents. Every write reuses the console server actions, so the
 * live role check (publishing needs MANAGER+), validation and audit trail are the
 * UI's own. Making an incident public is the one step beyond AGENT, checked up
 * front so a refused publish never leaves a half-applied edit behind.
 */

const LIST_LIMIT = 20;

/** Map service names (case-insensitive) to ids; reports every name that matched nothing. */
async function resolveServiceIds(names: string[]): Promise<{ ids: string[] } | { error: string }> {
  const all = await db.service.findMany({ select: { id: true, name: true } });
  const byName = new Map(all.map((s) => [s.name.toLowerCase(), s.id]));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id) ids.push(id);
    else unknown.push(name);
  }
  return unknown.length
    ? { error: `Unknown service(s): ${unknown.join(", ")}. Use exact service names.` }
    : { ids: [...new Set(ids)] };
}

function withServiceIds(formData: FormData, ids: string[]): FormData {
  for (const id of ids) formData.append("serviceId", id);
  return formData;
}

const serviceNames = z.array(z.string()).describe("exact names of the affected services");
const impactEnum = z.enum(STATUS_INCIDENT_IMPACTS);
const stateEnum = z.enum(STATUS_INCIDENT_STATES);

export const OPERATIONS: AiOperation[] = [
  {
    id: "status_incident.list",
    group: "Status page",
    kind: "read",
    minRole: "AGENT",
    description:
      "List status page incidents (drafts and public ones) with their ids, newest first. Call this to find the id of an incident before updating it or posting an update.",
    input: z.object({ activeOnly: z.boolean().optional().describe("only incidents that are not resolved yet") }),
    run: async (a) => {
      const rows = await db.statusIncident.findMany({
        where: a.activeOnly ? { state: { in: [...ACTIVE_STATUS_INCIDENT_STATES] } } : {},
        orderBy: { startedAt: "desc" },
        take: LIST_LIMIT,
        select: {
          id: true, title: true, state: true, impact: true, isPublic: true,
          services: { select: { service: { select: { name: true } } } },
          ticket: { select: { id: true, type: true, prefix: true } },
        },
      });
      if (rows.length === 0) return ok("No status incidents.", { incidents: [] });
      const incidents = rows.map((r) => ({
        id: r.id,
        title: r.title,
        state: r.state,
        impact: r.impact,
        public: r.isPublic,
        services: r.services.map((s) => s.service.name),
        ticket: r.ticket ? ticketRef(r.ticket.id, r.ticket.prefix || r.ticket.type) : null,
      }));
      return ok(`${incidents.length} status incidents.`, { incidents });
    },
  },
  {
    id: "status_incident.create",
    group: "Status page",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a status page incident. It is saved as a DRAFT unless publish=true, which needs the MANAGER role. Optionally link the major-incident ticket, name the affected services and post a first update.",
    input: z.object({
      title: z.string().min(3).describe("short public title, e.g. 'Email delivery delays'"),
      summary: z.string().optional().describe("short public description"),
      impact: impactEnum.optional().describe("NONE, MINOR, MAJOR or CRITICAL (default MINOR)"),
      state: stateEnum.optional().describe("INVESTIGATING (default), IDENTIFIED, MONITORING or RESOLVED"),
      services: serviceNames.optional(),
      ticket: z.string().optional().describe("number of the linked major-incident ticket"),
      update: z.string().optional().describe("first timeline update text"),
      publish: z.boolean().optional().describe("make it public right away (MANAGER+)"),
    }),
    label: (a) => `Create ${a.publish ? "public" : "draft"} status incident “${a.title}”`,
    run: async (a, ctx) => {
      if (a.publish && !canPublishStatusIncident(ctx.role)) return err(PUBLISH_REFUSAL);
      const services = await resolveServiceIds((a.services as string[] | undefined) ?? []);
      if ("error" in services) return err(services.error);
      const formData = toFormData({
        title: a.title,
        summary: str(a.summary),
        impact: a.impact ?? "MINOR",
        state: a.state ?? "INVESTIGATING",
        ticketId: str(a.ticket),
        updateBody: str(a.update),
        isPublic: a.publish === true,
      });
      const res = await createStatusIncident(withServiceIds(formData, services.ids));
      return fromActionResult(res, `Created ${a.publish ? "public" : "draft"} status incident "${a.title}" (id ${res.id})`);
    },
  },
  {
    id: "status_incident.update",
    group: "Status page",
    kind: "write",
    minRole: "AGENT",
    description:
      "Edit a status page incident: title, public summary, impact, affected services, linked ticket ('none' clears it). publish=true/false makes it public or retracts it (MANAGER+). To change the state post an update instead. Omitted fields stay as they are; `services` replaces the whole list.",
    input: z.object({
      id: z.string().describe("the incident id from status_incident_list"),
      title: z.string().min(3).optional(),
      summary: z.string().optional(),
      impact: impactEnum.optional(),
      services: serviceNames.optional(),
      ticket: z.string().optional().describe("linked ticket number, or 'none'"),
      publish: z.boolean().optional().describe("true publishes, false retracts (MANAGER+)"),
    }),
    label: (a) => `Update status incident ${a.id}`,
    run: async (a, ctx) => {
      const current = await db.statusIncident.findUnique({
        where: { id: String(a.id) },
        select: {
          id: true, title: true, summary: true, impact: true, ticketId: true, isPublic: true,
          services: { select: { serviceId: true } },
        },
      });
      if (!current) return err("Status incident not found. Call status_incident_list for valid ids.");
      const changesVisibility = typeof a.publish === "boolean" && a.publish !== current.isPublic;
      if (changesVisibility && !canPublishStatusIncident(ctx.role)) return err(PUBLISH_REFUSAL);

      const requested = a.services as string[] | undefined;
      let serviceIds = current.services.map((s) => s.serviceId);
      if (requested) {
        const services = await resolveServiceIds(requested);
        if ("error" in services) return err(services.error);
        serviceIds = services.ids;
      }
      const ticket = str(a.ticket);
      const formData = toFormData({
        id: current.id,
        title: str(a.title) ?? current.title,
        summary: a.summary === undefined ? (current.summary ?? "") : a.summary,
        impact: a.impact ?? current.impact,
        ticketId: ticket === undefined ? (current.ticketId ?? "") : ticket.toLowerCase() === "none" ? "" : ticket,
      });
      const edit = actionRefusal(await updateStatusIncident(withServiceIds(formData, serviceIds)));
      if (edit) return edit;
      if (changesVisibility) {
        const visibility = actionRefusal(
          await setStatusIncidentVisibility(toFormData({ incidentId: current.id, isPublic: String(a.publish) })),
        );
        if (visibility) return visibility;
      }
      return ok(`Updated status incident "${str(a.title) ?? current.title}"${changesVisibility ? (a.publish ? " and published it" : " and retracted it") : ""}`);
    },
  },
  {
    id: "status_incident.post_update",
    group: "Status page",
    kind: "write",
    minRole: "AGENT",
    description:
      "Post a timeline update on a status page incident and move it to a new state (INVESTIGATING, IDENTIFIED, MONITORING, RESOLVED). The update is public as soon as the incident is public, so write it for end users.",
    input: z.object({
      id: z.string().describe("the incident id from status_incident_list"),
      state: stateEnum,
      body: z.string().min(3).describe("the update text, written for end users"),
    }),
    label: (a) => `Post ${a.state} update on status incident ${a.id}`,
    run: async (a) => {
      const res = await postStatusIncidentUpdate(toFormData({ incidentId: a.id, state: a.state, body: a.body }));
      return fromActionResult(res, `Posted a ${a.state} update`);
    },
  },
];
