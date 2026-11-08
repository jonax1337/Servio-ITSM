import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { PORTAL_CATALOG_ITEM_WHERE, PORTAL_CATEGORY_WHERE } from "@/lib/categories";
import { webSearchTool, fetchUrlTool } from "@/lib/ai-tools";
import { parseFormSchema } from "@/lib/service-forms";
import { TICKET_TYPES, PRIORITIES, IMPACT_URGENCY, ticketRef, AI_ASSISTANT_NAME } from "@/lib/constants";
import { listPublicIncidents } from "@/lib/status-incidents";

/**
 * Sable for the Self-Service Portal — an END-USER assistant.
 *
 * Safer and smaller than the agent-console Sable (lib/ai-tools.ts): the read tools
 * only touch PUBLIC, PUBLISHED content plus the keyless, SSRF-guarded web tools.
 * The two "write" paths (propose_request / propose_service_request) never mutate
 * on their own — they return a draft the user confirms with one click in the
 * widget, which then routes it exactly like the hand-filled forms.
 */

const portalKnowledgeTool = tool({
  description:
    "Search the public help center (published, public knowledge-base articles) for guides and answers. Use this FIRST for any 'how do I…' or troubleshooting question. Only returns articles end users are allowed to read.",
  inputSchema: z.object({ query: z.string().describe("keywords to search help articles for") }),
  execute: async ({ query }) => {
    const rows = await db.article.findMany({
      where: {
        status: "PUBLISHED",
        visibility: "PUBLIC",
        OR: [{ title: { contains: query } }, { excerpt: { contains: query } }, { body: { contains: query } }],
      },
      take: 5,
      orderBy: { views: "desc" },
      select: { title: true, slug: true, excerpt: true },
    });
    return rows.length
      ? rows.map((r) => ({ title: r.title, url: `/portal/knowledge/${r.slug}`, excerpt: r.excerpt ?? "" }))
      : [{ title: "No matching articles", url: "", excerpt: "" }];
  },
});

const portalCatalogTool = tool({
  description:
    "Search the service catalog (published, requestable services: hardware, access, software, onboarding, etc.). Use when the user wants to REQUEST or GET something. Returns each service's id, a link, whether it needs approval, and whether it has a request form.",
  inputSchema: z.object({ query: z.string().describe("keywords to search the catalog for") }),
  execute: async ({ query }) => {
    const rows = await db.catalogItem.findMany({
      where: {
        ...PORTAL_CATALOG_ITEM_WHERE,
        OR: [{ name: { contains: query } }, { shortDescription: { contains: query } }, { description: { contains: query } }],
      },
      take: 5,
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, shortDescription: true, description: true, requiresApproval: true, formSchema: true,
        service: { select: { group: { select: { name: true } } } },
        category: { select: { group: { select: { name: true } } } },
      },
    });
    return rows.length
      ? rows.map((r) => ({
          id: r.id,
          name: r.name,
          url: `/portal/request/${r.id}`,
          description: r.shortDescription ?? r.description ?? "",
          requiresApproval: r.requiresApproval,
          hasForm: parseFormSchema(r.formSchema).length > 0,
          handledBy: r.service?.group?.name ?? r.category?.group?.name ?? null,
        }))
      : [{ id: "", name: "No matching services", url: "", description: "", requiresApproval: false, hasForm: false, handledBy: null }];
  },
});

const listCategoriesTool = tool({
  description:
    "List the ticket categories so you can tag a request with the best-fitting one (helps it get routed and organised). Call this before propose_request when you're unsure which category fits.",
  inputSchema: z.object({}),
  execute: async () => {
    const rows = await db.category.findMany({
      where: PORTAL_CATEGORY_WHERE,
      orderBy: { name: "asc" },
      select: { id: true, name: true, group: { select: { name: true } } },
    });
    return rows.length
      ? rows.map((r) => ({ id: r.id, name: r.name, handledBy: r.group?.name ?? null }))
      : [{ id: "", name: "No categories", handledBy: null }];
  },
});

const getServiceFormTool = tool({
  description:
    "Get the request form fields for a catalog service (by its id from search_catalog). Returns each field's key, label, type, whether it's required, and any select options. Use this so you know exactly what to ask the user before filling the form.",
  inputSchema: z.object({ itemId: z.string().describe("the catalog item id from search_catalog") }),
  execute: async ({ itemId }) => {
    const item = await db.catalogItem.findUnique({ where: { id: itemId }, select: { name: true, formSchema: true, isPublished: true } });
    if (!item || !item.isPublished) return { ok: false, error: "That service isn't available." };
    const fields = parseFormSchema(item.formSchema);
    return {
      ok: true,
      service: item.name,
      fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required, options: f.options ?? [] })),
    };
  },
});

/**
 * The current turn's attachments, slimmed for the wire. They ride along on the
 * propose_* tool RESULT so the confirm card can link them to the ticket it
 * creates (assistant-ui inlines attachments for vision but never stages an
 * upload, so there's no id to link — the files travel with the draft instead).
 */
export type ProposalAttachment = { name: string; type: string; dataUrl: string };

function proposeRequestToolFor(attachments: ProposalAttachment[]) {
  return tool({
    description:
      "PROPOSE creating a free-form request/ticket (an issue to fix or a simple ask) so it gets logged and routed. This does NOT create anything yet — it drafts a request the user confirms with one click. Only call once you have a clear title AND a helpful description. Set a fitting categoryId from list_categories when you can.",
    inputSchema: z.object({
      title: z.string().describe("short one-line summary (min 3 chars)"),
      type: z.enum(TICKET_TYPES).describe("INCIDENT for a problem, REQUEST to obtain something"),
      priority: z.enum(PRIORITIES).describe("LOW, MEDIUM, HIGH or CRITICAL — default MEDIUM"),
      impact: z.enum(IMPACT_URGENCY).describe("how widely this affects people: LOW = just this user, MEDIUM = a team, HIGH = many/all"),
      urgency: z.enum(IMPACT_URGENCY).describe("how time-sensitive: LOW = whenever, MEDIUM = soon, HIGH = blocking work now"),
      description: z.string().describe("a clear description of the problem or request in the user's words"),
      categoryId: z.string().optional().describe("best-matching category id from list_categories, if any"),
      attachFiles: z
        .boolean()
        .optional()
        .describe(
          "Whether to attach the user's current screenshot(s)/file(s) to this request. Defaults to true. Set false ONLY if their attachment is not evidence for THIS request (e.g. it belongs to a different topic).",
        ),
    }),
    execute: async (input) => {
      const proposal = await buildTicketProposal(input);
      return proposal
        ? { ok: true, proposal, attachments: input.attachFiles === false ? [] : attachments }
        : { ok: false, error: "I need a clear title and description first." };
    },
  });
}

function proposeReplyToolFor(userId: string, attachments: ProposalAttachment[]) {
  return tool({
    description:
      "PROPOSE posting a public reply on one of the user's OWN open tickets — e.g. to add information an agent asked for, or an update. This does NOT post anything; the user confirms it. Give the ticket ref (from list_my_tickets/get_my_ticket) and the message text in the user's words.",
    inputSchema: z.object({
      ref: z.string().describe("the ticket ref or number, e.g. 'INC-0139'"),
      body: z.string().describe("the reply text to post, in plain language"),
      attachFiles: z
        .boolean()
        .optional()
        .describe(
          "Whether to attach the user's current screenshot(s)/file(s) to this reply. Defaults to true. Set false ONLY if their attachment is not relevant to this ticket.",
        ),
    }),
    execute: async (input) => {
      const proposal = await buildCommentProposal(userId, input);
      return proposal
        ? { ok: true, proposal, attachments: input.attachFiles === false ? [] : attachments }
        : { ok: false, error: "I couldn't find that open ticket of yours." };
    },
  });
}

function proposeServiceRequestToolFor(attachments: ProposalAttachment[]) {
  return tool({
    description:
      "PROPOSE ordering a catalog service on the user's behalf, with its request form filled in. Use for catalog items that have a form (hasForm=true). Fill answers using the fields from get_service_form. This does NOT submit anything — it drafts the order for the user to confirm. Make sure every required field has an answer.",
    inputSchema: z.object({
      itemId: z.string().describe("the catalog item id from search_catalog"),
      answers: z
        .array(z.object({ key: z.string().describe("the field key"), value: z.string().describe("the user's answer") }))
        .describe("one entry per form field you have an answer for"),
      attachFiles: z
        .boolean()
        .optional()
        .describe(
          "Whether to attach the user's current screenshot(s)/file(s) to this order. Defaults to true. Set false ONLY if their attachment is not relevant to this service request.",
        ),
    }),
    execute: async (input) => {
      const proposal = await buildServiceProposal(input);
      return proposal
        ? { ok: true, proposal, attachments: input.attachFiles === false ? [] : attachments }
        : { ok: false, error: "That service isn't available or is missing required answers." };
    },
  });
}

/* ── User-scoped tools: only ever the signed-in user's OWN tickets, and only
      the content they can already see in the portal (never internal notes). ── */

function myTicketsTool(userId: string) {
  return tool({
    description:
      "List the signed-in user's OWN tickets (their own requests) with current status. Use for questions like 'what's the status of my request' or 'do I have anything open'. Never shows anyone else's tickets.",
    inputSchema: z.object({ query: z.string().optional().describe("optional keywords to filter their tickets by title") }),
    execute: async ({ query }) => {
      const rows = await db.ticket.findMany({
        where: { requesterId: userId, ...(query ? { title: { contains: query } } : {}) },
        take: 10,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, prefix: true, type: true, status: true, priority: true, updatedAt: true },
      });
      return rows.length
        ? rows.map((t) => ({
            ref: ticketRef(t.id, t.prefix),
            title: t.title,
            type: t.type,
            status: t.status,
            priority: t.priority,
            url: `/portal/tickets/${t.id}`,
            updated: t.updatedAt.toISOString().slice(0, 10),
          }))
        : [{ ref: "", title: "You have no tickets yet", type: "", status: "", priority: "", url: "", updated: "" }];
    },
  });
}

function myTicketTool(userId: string) {
  return tool({
    description:
      "Read ONE of the user's OWN tickets in full: its description, status, who's handling it, and the PUBLIC conversation. It NEVER returns internal agent notes. Give the ticket ref or number.",
    inputSchema: z.object({ ref: z.string().describe("the ticket ref or number, e.g. 'INC-0139' or '139'") }),
    execute: async ({ ref }) => {
      const id = parseInt(String(ref).replace(/\D/g, ""), 10);
      if (!Number.isFinite(id)) return { error: "Please give a ticket number, e.g. INC-0139." };
      const t = await db.ticket.findFirst({
        where: { id, requesterId: userId }, // scoped to the caller's own tickets
        select: {
          id: true, title: true, prefix: true, type: true, status: true, priority: true, description: true, createdAt: true,
          assignee: { select: { name: true } },
          // Only public (non-internal) comments — the exact set the portal shows.
          comments: {
            where: { isInternal: false },
            orderBy: { createdAt: "asc" },
            take: 20,
            select: { body: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      });
      if (!t) return { error: "No such ticket, or it doesn't belong to you." };
      return {
        ref: ticketRef(t.id, t.prefix),
        title: t.title,
        type: t.type,
        status: t.status,
        priority: t.priority,
        description: t.description || "(no description)",
        handledBy: t.assignee?.name ?? "not yet assigned",
        replies: t.comments.map((c) => ({
          from: c.author?.name ?? "Service Desk",
          when: c.createdAt.toISOString().slice(0, 10),
          text: (c.body ?? "").slice(0, 1200),
        })),
      };
    },
  });
}

function statusIncidentsTool(userId: string) {
  return tool({
    description:
      "List the PUBLIC service status incidents that are active right now (known outages and degradations the Service Desk has announced), with their latest update. Call this BEFORE proposing a request when the user reports something not working, so you can tell them it is already a known issue. Never includes unpublished incidents.",
    inputSchema: z.object({}),
    execute: async () => {
      const incidents = await listPublicIncidents(userId, "active", 5);
      if (incidents.length === 0) return { incidents: [], note: "No known issues right now." };
      return {
        incidents: incidents.map((i) => ({
          title: i.title,
          state: i.state,
          impact: i.impact,
          affects: i.services,
          summary: i.summary ?? "",
          latestUpdate: i.updates[0]?.body.slice(0, 600) ?? "",
          url: "/portal/status",
          alreadyFollowing: i.joined,
          canReportAffected: i.canJoin && !i.joined,
        })),
      };
    },
  });
}

/** Read tools that depend on neither the caller nor the turn's attachments. */
const SHARED_READ_TOOLS = {
  search_knowledge: portalKnowledgeTool,
  search_catalog: portalCatalogTool,
  list_categories: listCategoriesTool,
  get_service_form: getServiceFormTool,
  web_search: webSearchTool,
  fetch_url: fetchUrlTool,
};

/**
 * Full tool set for a specific signed-in user. `attachments` (the current turn's
 * inline files) are closed into the propose_* tools so their result carries the
 * files for the confirm card to link.
 */
export function buildPortalTools(userId: string, attachments: ProposalAttachment[] = []) {
  return {
    ...SHARED_READ_TOOLS,
    propose_request: proposeRequestToolFor(attachments),
    propose_service_request: proposeServiceRequestToolFor(attachments),
    propose_reply: proposeReplyToolFor(userId, attachments),
    list_status_incidents: statusIncidentsTool(userId),
    list_my_tickets: myTicketsTool(userId),
    get_my_ticket: myTicketTool(userId),
  };
}

export const SYSTEM_PROMPT = `You are ${AI_ASSISTANT_NAME}, the friendly assistant in the Servio Help Center. You help employees and customers get unblocked quickly, and you can act on their behalf.

Who you are talking to: a non-technical end user. Be warm, calm, and plain-spoken. No jargon. Keep answers short — usually two to four sentences or a tight bulleted list.

What you can do, in order of preference:
0. CHECK THEIR TICKETS: for "what's the status of my request", "any updates on my ticket", etc., call list_my_tickets or get_my_ticket. You only ever see the user's OWN tickets and only their public content (never internal agent notes). Summarise the current status and the latest reply in plain language.
0b. KNOWN ISSUES: when the user says something is down, slow or not working, call list_status_incidents first. If an active incident matches, tell them it is already a known issue, share the latest update, and link [the status page](/portal/status), where the "This affects me too" button lets them register without filing a duplicate. Only open a new request if nothing matches or they have a different problem.
1. ANSWER: for a problem or "how do I…" question, call search_knowledge first and answer from it, linking the article by its url, e.g. [Reset your password](/portal/knowledge/reset-password). If the help center has nothing and it's a general how-to, you may use web_search (and fetch_url to read a result) and give a short, safe answer, noting it's from the public web.
2. GUIDE TO A SERVICE: when the user wants to obtain something, call search_catalog and point them to the matching service.
3. FILL A FORM FOR THEM: if that service has a request form (hasForm=true), call get_service_form, ask the user for any required fields you don't already know, then call propose_service_request with the answers so they can confirm and submit in one click.
4. OPEN A REQUEST: if the issue needs a person and isn't a catalog service, gather a clear title and short description, optionally call list_categories to pick a fitting categoryId, then call propose_request. Use INCIDENT for problems, REQUEST to obtain something. Judge impact (how many people are affected: just them, a team, or many) and urgency (how time-sensitive it is) from what the user tells you, and set priority accordingly (MEDIUM by default; CRITICAL only for outages or many blocked users). If a knowledge-base article is relevant to the issue, reference it in the description (its markdown link) so the assignee has that context.
5. REPLY TO A TICKET: if the user wants to add information or respond on an existing request of theirs (e.g. "tell them it's still happening"), find it with list_my_tickets/get_my_ticket, then call propose_reply with the ticket ref and the message. Call propose_reply directly once you have the ref and text — do not ask for permission in plain text first; the confirm button the user sees IS the confirmation. It only works on their own open tickets.

Reading attachments: the user can attach screenshots or files. Read any attached image (e.g. an error dialog), quote the exact error text you see, and use it to search_knowledge / web_search for a fix. If it needs a person, propose_request and mention that their attachment will be added to the ticket. When you create a request, reply, or order, the user's attached files are linked to it by default — but set attachFiles=false on that call if the attachment is NOT relevant to that particular request (e.g. they attached one screenshot but asked for something unrelated in the same message). Never attach an unrelated file just because it's there.

Hard rules:
- Only mention articles or services the tools actually returned. Never invent titles, links, ids, or facts.
- You can only see public help articles, the catalog and announced status incidents. You cannot see ticket queues, other people's tickets, accounts, or internal system details.
- A propose_* call only DRAFTS — the user still confirms. Don't claim something is done until they've confirmed.
- Ask for missing required details before proposing; never guess required form answers.
- Some categories and services include a "handledBy" team. You may reassure the user which team typically handles it, but you do not assign or change teams yourself — routing is handled automatically.
- Always answer in the user's language.
- Write in clean plain text: no emojis, and use normal punctuation (hyphens, not em-dashes).`;


/* ── Proposal shapes surfaced to the widget and validated at create time ── */

export const TicketProposalSchema = z.object({
  kind: z.literal("ticket"),
  title: z.string().min(3).max(140),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(PRIORITIES).catch("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).catch("MEDIUM"),
  urgency: z.enum(IMPACT_URGENCY).catch("MEDIUM"),
  description: z.string().max(4000).default(""),
  categoryId: z.string().nullish(),
  categoryName: z.string().nullish(),
});

export const ServiceProposalSchema = z.object({
  kind: z.literal("service"),
  itemId: z.string().min(1),
  itemName: z.string(),
  requiresApproval: z.boolean().default(false),
  answers: z.array(z.object({ key: z.string(), label: z.string(), value: z.string() })).max(40).default([]),
});

export const CommentProposalSchema = z.object({
  kind: z.literal("comment"),
  ticketId: z.number().int().positive(),
  ref: z.string(),
  body: z.string().min(1).max(5000),
});

export const ProposalSchema = z.discriminatedUnion("kind", [TicketProposalSchema, ServiceProposalSchema, CommentProposalSchema]);
export type RequestProposal = z.infer<typeof ProposalSchema>;

/** Resolve a propose_reply draft to one of the caller's OWN open tickets. */
async function buildCommentProposal(userId: string, input: unknown): Promise<RequestProposal | null> {
  const raw = z.object({ ref: z.string(), body: z.string().min(1) }).safeParse(input);
  if (!raw.success) return null;
  const id = parseInt(raw.data.ref.replace(/\D/g, ""), 10);
  if (!Number.isFinite(id)) return null;
  const t = await db.ticket.findFirst({
    where: { id, requesterId: userId },
    select: { id: true, prefix: true, status: true },
  });
  if (!t || t.status === "CLOSED" || t.status === "CANCELLED") return null;
  return { kind: "comment", ticketId: t.id, ref: ticketRef(t.id, t.prefix), body: raw.data.body.slice(0, 5000) };
}

async function buildTicketProposal(input: unknown): Promise<RequestProposal | null> {
  const raw = z
    .object({
      title: z.string().min(3),
      type: z.enum(TICKET_TYPES),
      priority: z.enum(PRIORITIES).catch("MEDIUM"),
      impact: z.enum(IMPACT_URGENCY).catch("MEDIUM"),
      urgency: z.enum(IMPACT_URGENCY).catch("MEDIUM"),
      description: z.string().default(""),
      categoryId: z.string().nullish(),
    })
    .safeParse(input);
  if (!raw.success) return null;
  let categoryName: string | null = null;
  if (raw.data.categoryId) {
    const cat = await db.category.findFirst({ where: { id: raw.data.categoryId, ...PORTAL_CATEGORY_WHERE }, select: { name: true } });
    categoryName = cat?.name ?? null;
    if (!cat) raw.data.categoryId = null; // drop an invented/stale id
  }
  return { kind: "ticket", categoryName, ...raw.data };
}

async function buildServiceProposal(input: unknown): Promise<RequestProposal | null> {
  const raw = z
    .object({ itemId: z.string().min(1), answers: z.array(z.object({ key: z.string(), value: z.string() })).default([]) })
    .safeParse(input);
  if (!raw.success) return null;
  const item = await db.catalogItem.findUnique({
    where: { id: raw.data.itemId },
    select: { name: true, formSchema: true, isPublished: true, requiresApproval: true },
  });
  if (!item || !item.isPublished) return null;
  const fields = parseFormSchema(item.formSchema);
  const byKey = new Map(raw.data.answers.map((a) => [a.key, a.value]));
  const answers = fields.map((f) => ({ key: f.key, label: f.label, value: byKey.get(f.key) ?? "" }));
  return { kind: "service", itemId: raw.data.itemId, itemName: item.name, requiresApproval: item.requiresApproval, answers };
}

/** A file the user attached to the current chat turn (data URL from the browser). */
export type ChatAttachment = { name: string; type: string; size: number; dataUrl: string };

type UserPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string };

const TEXT_LIKE = /\.(txt|log|csv|eml)$/i;

/** Build a multimodal user message from text + attachments (images/PDF/text). */
export function buildUserParts(text: string, atts: ChatAttachment[]): UserPart[] {
  const parts: UserPart[] = [];
  const blocks: string[] = [text?.trim() ? text.trim() : ""];
  const notes: string[] = [];
  let images = 0;

  for (const a of atts) {
    if (a.type.startsWith("image/") && images < 4) {
      parts.push({ type: "image", image: a.dataUrl });
      notes.push(`- image: ${a.name}`);
      images++;
    } else if (a.type === "application/pdf") {
      parts.push({ type: "file", data: a.dataUrl, mediaType: "application/pdf" });
      notes.push(`- document: ${a.name} (PDF)`);
    } else if (a.type.startsWith("text/") || TEXT_LIKE.test(a.name)) {
      const comma = a.dataUrl.indexOf(",");
      let body = "";
      try { body = Buffer.from(a.dataUrl.slice(comma + 1), "base64").toString("utf8").slice(0, 8000); } catch { body = "(unreadable)"; }
      blocks.push(`\n\n[Attached file: ${a.name}]\n"""\n${body}\n"""`);
    } else {
      notes.push(`- file: ${a.name} (${a.type || "unknown"})`);
    }
  }
  if (notes.length) blocks.push(`\n\nThe user attached:\n${notes.join("\n")}`);
  parts.unshift({ type: "text", text: blocks.join("").trim() || "(see attachment)" });
  return parts;
}
