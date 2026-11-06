import { z } from "zod";
import { db } from "@/lib/db";
import { changeRef, PREFIX, releaseRef } from "@/lib/constants";
import { addChangeToRelease, createRelease } from "@/lib/releases";
import { createChangeFromTemplate } from "@/lib/change-templates";
import type { AiOperation } from "../types";
import { actionRefusal, err, ok, parseRecordNumber, str } from "../helpers";

/**
 * Releases and change templates. Writes reuse the same services as the UI actions
 * (lib/releases.ts, lib/change-templates.ts), so every rule that applies there applies here.
 */

const RELEASE_PREFIX = "REL";

function parseDate(value: unknown): Date | null | undefined {
  const text = str(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function findTemplateByName(name: string) {
  const wanted = name.trim().toLowerCase();
  const templates = await db.changeTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return { match: templates.find((t) => t.name.toLowerCase() === wanted), names: templates.map((t) => t.name) };
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "release.create",
    group: "Releases",
    kind: "write",
    minRole: "AGENT",
    description: "Create a release (a bundle of changes that ship together). You become its owner. Add changes afterwards with release.add_change.",
    input: z.object({
      name: z.string().min(3).describe("release name, e.g. 'March platform update'"),
      description: z.string().optional(),
    }),
    label: (a) => `Create release “${a.name}”`,
    run: async (a, ctx) => {
      const res = await createRelease(ctx.userId, {
        name: String(a.name ?? ""),
        description: str(a.description) ?? null,
        ownerId: ctx.userId,
        groupId: null,
      });
      if (!res.ok) return err(res.error);
      return ok(`Created ${releaseRef(res.id)} “${str(a.name)}”`, { id: res.id, ref: releaseRef(res.id) });
    },
  },
  {
    id: "release.add_change",
    group: "Releases",
    kind: "write",
    minRole: "AGENT",
    description: "Add a change to a release that is still in Planning. A change can ship in only one release.",
    input: z.object({
      release: z.string().describe("release reference, e.g. REL-0003"),
      change: z.string().describe("change reference, e.g. CHG-0042"),
    }),
    label: (a) => `Add ${a.change} to ${a.release}`,
    run: async (a, ctx) => {
      const releaseId = parseRecordNumber(a.release, [RELEASE_PREFIX]);
      if (!releaseId) return err(`Not a release reference: ${a.release}`);
      const changeId = parseRecordNumber(a.change, [PREFIX.change]);
      if (!changeId) return err(`Not a change reference: ${a.change}`);
      const refusal = actionRefusal(await addChangeToRelease(ctx.userId, releaseId, changeId));
      return refusal ?? ok(`Added ${changeRef(changeId)} to ${releaseRef(releaseId)}`);
    },
  },
  {
    id: "change_template.list",
    group: "Releases",
    kind: "read",
    minRole: "AGENT",
    description:
      "List the active change templates with their exact names and what each one pre-fills. ALWAYS call this before change.create_from_template and use a returned `name` verbatim.",
    input: z.object({}),
    run: async () => {
      const rows = await db.changeTemplate.findMany({
        where: { isActive: true },
        select: { name: true, summary: true, type: true, risk: true, service: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: 200,
      });
      if (rows.length === 0) return ok("No change templates exist yet.", { templates: [] });
      const templates = rows.map((t) => ({
        name: t.name,
        summary: t.summary,
        type: t.type,
        risk: t.risk,
        service: t.service?.name ?? null,
        preApproved: t.type === "STANDARD",
      }));
      return ok(`${templates.length} templates. STANDARD ones are pre-approved on creation.`, { templates });
    },
  },
  {
    id: "change.create_from_template",
    group: "Releases",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a change from a change template (by its exact name; see change_template.list). Everything is pre-filled from the template; optionally override the title, description, reason or planned window. A change from a STANDARD template is pre-approved immediately; one from a NORMAL template starts as a draft. You become the assignee. This is the only way to create a STANDARD change.",
    input: z.object({
      template: z.string().describe("exact template name"),
      title: z.string().optional(),
      description: z.string().optional(),
      reason: z.string().optional(),
      plannedStart: z.string().optional().describe("ISO date-time"),
      plannedEnd: z.string().optional().describe("ISO date-time"),
    }),
    label: (a) => `Create a change from template “${a.template}”`,
    run: async (a, ctx) => {
      const { match, names } = await findTemplateByName(String(a.template ?? ""));
      if (!match) {
        return err(`Template not found: ${a.template}. Active templates: ${names.length ? names.join(", ") : "none"}.`);
      }
      const plannedStart = parseDate(a.plannedStart);
      const plannedEnd = parseDate(a.plannedEnd);
      if (plannedStart === null || plannedEnd === null) return err("plannedStart/plannedEnd must be ISO date-times.");

      const res = await createChangeFromTemplate(ctx.userId, match.id, {
        title: str(a.title),
        description: str(a.description),
        reason: str(a.reason),
        assigneeId: ctx.userId,
        plannedStart,
        plannedEnd,
      });
      if (!res.ok) return err(res.fieldErrors?.plannedEnd?.[0] ?? res.error);

      const ref = changeRef(res.changeId);
      const data = { id: res.changeId, ref };
      if (res.preApproved) return ok(`Created ${ref} from “${match.name}” and pre-approved it (standard change)`, data);
      if (res.approvalError) return ok(`Created ${ref} from “${match.name}” as a draft. Pre-approval was refused: ${res.approvalError}`, data);
      return ok(`Created ${ref} from “${match.name}” as a draft`, data);
    },
  },
];
