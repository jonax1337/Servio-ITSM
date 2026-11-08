import { z } from "zod";
import { TICKET_TYPES, TICKET_STATUSES, PRIORITIES, IMPACT_URGENCY, RESOLUTION_CODES } from "@/lib/constants";
import { externalRefSchema } from "@/lib/ticket-external-ref";

/**
 * Request bodies of the /api/v1/tickets endpoints. Keys are camelCase; the
 * handlers run lib/api-case.ts first, so the snake_case spelling is accepted too.
 * Shared with the OpenAPI route so the spec can't drift from what is accepted.
 */

/** What POST /tickets does when an OPEN ticket already carries the `externalRef`. */
export const ON_DUPLICATE = ["return", "comment"] as const;

export const ticketCreateSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().default(""),
  type: z.enum(TICKET_TYPES).optional().default("INCIDENT"),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  urgency: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  status: z.enum(TICKET_STATUSES).optional().default("NEW"),
  requesterId: z.string().optional(),
  assigneeId: z.string().optional(),
  /** Agent tokens only. Without it, the category's team (if any) becomes the group. */
  groupId: z.string().optional(),
  categoryId: z.string().optional(),
  serviceId: z.string().optional(),
  /** Integration key (e.g. "zabbix:event:12345"): at most one OPEN ticket carries it. Agent tokens only. */
  externalRef: externalRefSchema.optional(),
  /** `return` (default): answer with the open ticket; `comment`: also add the description to it as an internal note. */
  onDuplicate: z.enum(ON_DUPLICATE).optional().default("return"),
});

export type TicketCreate = z.infer<typeof ticketCreateSchema>;

/** POST /tickets/ref/{ref}/resolve — the console's resolution dialog, for the open ticket carrying the ref. */
export const ticketResolveSchema = z.strictObject({
  resolutionNote: z.string().trim().max(50_000).optional(),
  resolutionCode: z.enum(RESOLUTION_CODES).optional(),
  /** Whether the note is an internal one (default) or a public reply that goes out with the resolution mail. */
  internal: z.boolean().optional().default(true),
});

/** The comment a deduplicated alert leaves on the open ticket: its description, else its title; capped like any comment. */
export function duplicateCommentText(input: { title: string; description?: string | null }): string {
  const text = (input.description ?? "").trim() || input.title.trim();
  return text.slice(0, 50_000);
}
