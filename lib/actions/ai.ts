"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { aiConfigured, generateAiText, generateAiObject } from "@/lib/ai";
import { getBoolSetting } from "@/lib/settings";
import { PRIORITIES, IMPACT_URGENCY, TICKET_TYPES, ticketRef, AI_ASSISTANT_NAME } from "@/lib/constants";
import { parseFormSchema, answersToText } from "@/lib/service-forms";
import { renderMarkdown } from "@/lib/markdown";
import { getOrgDirectory } from "@/lib/ai-context";
import { TICKET_RELATIONS_SELECT, relationLines } from "@/lib/ai-operations/ticket-relations";

/** Only agents/managers/admins may use the AI console (mirrors tickets.ts). */
async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const NOT_CONFIGURED =
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).";

/** Collapse whitespace for prompting. Ticket rows already carry a plaintext twin. */
function plain(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Load a ticket + its full comment thread and state fields by exact names. */
async function loadTicketContext(id: number) {
  return db.ticket.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true, email: true, isVip: true, department: true, jobTitle: true } },
      assignee: { select: { name: true } },
      category: { select: { name: true } },
      group: { select: { name: true } },
      sla: { select: { name: true } },
      assets: { select: { asset: { select: { name: true } } } },
      watchers: { select: { userId: true } },
      ...TICKET_RELATIONS_SELECT,
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          body: true,
          isInternal: true,
          createdAt: true,
          authorId: true,
          author: { select: { name: true } },
        },
      },
    },
  });
}

type TicketContext = NonNullable<Awaited<ReturnType<typeof loadTicketContext>>>;

function fmtDate(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
}

/** Human-readable "time since" so the model can reason about staleness. */
function relAge(from: Date): string {
  const ms = Date.now() - new Date(from).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins} minute(s) ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hour(s) ago`;
  return `${Math.floor(hrs / 24)} day(s) ago`;
}

/**
 * Catalog/service requests keep their real content in structured form answers
 * (formData), not in the description. Render those "Request details" so the model
 * actually sees what was requested.
 */
function renderRequestDetails(t: TicketContext): string | null {
  if (!t.formData) return null;
  let values: Record<string, unknown>;
  try {
    const parsed = JSON.parse(t.formData);
    if (!parsed || typeof parsed !== "object") return null;
    values = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const fields = parseFormSchema(t.formSchema);
  const text = fields.length
    ? answersToText(fields, values)
    : Object.entries(values)
        .map(([k, v]) => `• ${k}: ${typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "—")}`)
        .join("\n");
  return text.trim() ? text : null;
}

/**
 * Render the ticket into a state-aware transcript the model can actually reason
 * about: an explicit CURRENT STATE block (open/pending/resolved + resolution or
 * pending reason) and a discussion where each message is labelled by role
 * (Requester vs Agent) so direction and "what was tried / is it solved" are clear.
 */
function renderTicket(t: TicketContext): string {
  const closedStates = ["RESOLVED", "CLOSED", "CANCELLED"];
  const isClosed = closedStates.includes(t.status);

  // Who spoke last and how long ago — drives follow-up / auto-close reasoning.
  const last = t.comments[t.comments.length - 1];
  const lastRole = last ? (last.authorId === t.requester?.id ? "Requester" : "Agent") : "Requester";
  const lastAt = last ? last.createdAt : t.createdAt;
  const waitingOnRequester = !isClosed && lastRole === "Agent" && !last?.isInternal;

  // First reply: has any agent replied publicly to the requester yet?
  const hasPublicAgentReply = t.comments.some((c) => c.authorId !== t.requester?.id && !c.isInternal);

  const state = [
    `Status: ${t.status}${isClosed ? " (this ticket is no longer open)" : ""}`,
    `Priority: ${t.priority}  ·  Impact: ${t.impact}  ·  Urgency: ${t.urgency}`,
    t.isMajorIncident ? "⚠ Major incident" : null,
    t.status === "PENDING" || t.status === "ON_HOLD"
      ? `Waiting reason: ${t.pendingReason ?? "unspecified"}${t.pendingNote ? ` — ${plain(t.pendingNote)}` : ""}`
      : null,
    t.resolutionCode
      ? `Resolution: ${t.resolutionCode}${t.resolutionNote ? ` — ${plain(t.resolutionNote)}` : ""}`
      : null,
    `Opened: ${fmtDate(t.createdAt)}`,
    t.resolvedAt ? `Resolved: ${fmtDate(t.resolvedAt)}` : null,
    t.closedAt ? `Closed: ${fmtDate(t.closedAt)}` : null,
    `Last message: ${lastRole} wrote ${relAge(lastAt)}.`,
    waitingOnRequester
      ? "The requester has NOT replied since the agent's last public message — this may be waiting on the customer."
      : null,
    !isClosed && !hasPublicAgentReply
      ? "No agent has replied to the requester yet — the next public reply will be the FIRST response."
      : null,
  ].filter(Boolean);

  const details = renderRequestDetails(t);

  const r = t.requester;
  const requesterLine =
    `Requester: ${r?.name ?? "Unknown"}${r?.isVip ? " (VIP)" : ""}` +
    `${r?.jobTitle ? `, ${r.jobTitle}` : ""}${r?.department ? `, ${r.department} dept` : ""}` +
    `${r?.email ? ` <${r.email}>` : ""}`;
  const assets = t.assets.map((x) => x.asset.name);

  const header = [
    `Ref: ${ticketRef(t.id, t.prefix || t.type)}`,
    `Title: ${t.title}`,
    `Type: ${t.type}`,
    requesterLine,
    t.assignee?.name ? `Assigned agent: ${t.assignee.name}` : "Unassigned",
    t.category ? `Category: ${t.category.name}` : "Category: none",
    t.group ? `Team: ${t.group.name}` : "Team: none",
    t.sla ? `SLA policy: ${t.sla.name}` : null,
    assets.length ? `Linked assets: ${assets.join(", ")}` : null,
    t.watchers.length ? `Watchers: ${t.watchers.length}` : null,
    ...relationLines(t),
    "",
    "CURRENT STATE:",
    ...state,
    "",
    "Original request (from the requester):",
    plain(t.description) || "(no description)",
    // Catalog/service requests carry their real content here, not in the description.
    details ? "\nRequest details (from the request form):\n" + details : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const requesterId = t.requester?.id;
  const thread = t.comments
    .map((c) => {
      const role = c.authorId === requesterId ? "Requester" : `Agent (${c.author?.name ?? "unknown"})`;
      const tag = c.isInternal ? " [internal note, not seen by requester]" : "";
      return `— ${role}${tag}, ${fmtDate(c.createdAt)}:\n${plain(c.body)}`;
    })
    .join("\n\n");

  return thread ? `${header}\n\nDISCUSSION (oldest first):\n${thread}` : `${header}\n\n(No replies yet.)`;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "not", "please", "help", "issue", "problem", "request", "error",
  "cannot", "need", "new", "this", "that", "your", "have", "from", "when", "into", "does",
  "der", "die", "das", "und", "oder", "für", "mit", "nicht", "kein", "bitte", "ich", "eine",
]);

/** Cheap keyword extraction from a ticket for "similar tickets" lookup. */
function keywords(t: TicketContext): string[] {
  const words = `${t.title} ${t.description ?? ""}`.toLowerCase().match(/[a-zà-ÿ0-9]{4,}/gi) ?? [];
  return [...new Set(words)].filter((w) => !STOPWORDS.has(w)).slice(0, 6);
}

/** Find past tickets similar to this one, so triage can learn real routing patterns. */
async function findSimilarTickets(t: TicketContext) {
  const kws = keywords(t);
  if (kws.length === 0) return [];
  return db.ticket.findMany({
    where: {
      id: { not: t.id },
      OR: kws.flatMap((k) => [{ title: { contains: k } }, { description: { contains: k } }]),
    },
    take: 8,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, type: true, prefix: true, priority: true, status: true, resolutionCode: true,
      group: { select: { name: true } }, category: { select: { name: true } },
    },
  });
}

/** The rendered ticket context for the chat agent (auth-gated). */
export async function getTicketAiContext(ticketId: number): Promise<string | null> {
  const me = await requireAgent();
  if (!me) return null;
  const ticket = await loadTicketContext(ticketId);
  return ticket ? renderTicket(ticket) : null;
}

/* ── 1. suggestTriage — generateObject constrained to REAL category/team ids ── */

export type TriageField = "priority" | "impact" | "urgency" | "type" | "groupId" | "categoryId" | "serviceId";

export type TriageState =
  | {
      ok: true;
      priority: (typeof PRIORITIES)[number];
      impact: (typeof IMPACT_URGENCY)[number];
      urgency: (typeof IMPACT_URGENCY)[number];
      type: (typeof TICKET_TYPES)[number];
      groupId: string | null;
      categoryId: string | null;
      serviceId: string | null;
      /** Already-set fields the AI thinks are clearly wrong. */
      flagged: TriageField[];
      reasoning: string;
    }
  | { ok: false; error: string };

export async function suggestTriage(ticketId: number): Promise<TriageState> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };
  // Admins can turn off Sable's in-ticket triage suggestions without disabling
  // the rest of the assistant (chat, request handling, etc.).
  if (!(await getBoolSetting("AI_TICKET_TRIAGE", true))) {
    return { ok: false, error: "Triage suggestions are turned off" };
  }

  const ticket = await loadTicketContext(ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };

  // Valid id sets (cached round-trip). categories/groups/services are string cuids.
  const { categories, groups, services } = await getFormOptions();
  const catIds = categories.map((c) => c.id);
  const groupIds = groups.map((g) => g.id);
  const serviceIds = services.map((s) => s.id);

  // Enums built from the real ids → the model can't return a nonexistent id.
  const categoryEnum =
    catIds.length > 0 ? z.enum(["none", ...catIds] as [string, ...string[]]) : z.literal("none");
  const groupEnum =
    groupIds.length > 0 ? z.enum(["none", ...groupIds] as [string, ...string[]]) : z.literal("none");
  const serviceEnum =
    serviceIds.length > 0 ? z.enum(["none", ...serviceIds] as [string, ...string[]]) : z.literal("none");

  const schema = z.object({
    priority: z.enum(PRIORITIES),
    impact: z.enum(IMPACT_URGENCY),
    urgency: z.enum(IMPACT_URGENCY),
    type: z.enum(TICKET_TYPES),
    categoryId: categoryEnum,
    groupId: groupEnum,
    serviceId: serviceEnum,
    flagged: z.array(z.enum(["priority", "impact", "urgency", "type", "groupId", "categoryId", "serviceId"])),
    reasoning: z.string(),
  });

  // Same organisation context Sable uses in chat, so triage and chat reason alike.
  const orgDirectory = await getOrgDirectory();
  const catLegend = categories.map((c) => `- ${c.id}: ${c.name}`).join("\n") || "(none)";
  const groupLegend = groups.map((g) => `- ${g.id}: ${g.name}`).join("\n") || "(none)";
  const serviceLegend = services.map((s) => `- ${s.id}: ${s.name}`).join("\n") || "(none)";
  const curCat = ticket.categoryId ? (categories.find((c) => c.id === ticket.categoryId)?.name ?? "unknown") : "none";
  const curGroup = ticket.groupId ? (groups.find((g) => g.id === ticket.groupId)?.name ?? "unknown") : "none";
  const curSvc = ticket.serviceId ? (services.find((s) => s.id === ticket.serviceId)?.name ?? "unknown") : "none";

  // Ground the decision in how similar past tickets were actually routed/prioritised.
  const similar = await findSimilarTickets(ticket);
  const similarLegend =
    similar
      .map(
        (s) =>
          `- ${ticketRef(s.id, s.prefix || s.type)} [${s.status}] "${s.title}" → priority ${s.priority}, team ${s.group?.name ?? "none"}, category ${s.category?.name ?? "none"}${s.resolutionCode ? `, resolved ${s.resolutionCode}` : ""}`,
      )
      .join("\n") || "(no similar tickets found)";

  const system =
    `You are ${AI_ASSISTANT_NAME}, the triage brain of the Servio ITSM system. Read the whole ticket ` +
    "(state + discussion), then classify it. Decide the TYPE: INCIDENT when something is broken / not " +
    "working / degraded, REQUEST when the user asks for something new, standard or provisioned (access, " +
    "hardware, software, onboarding). Set IMPACT (how widespread the effect is: one person=LOW, a " +
    "team/site=MEDIUM, whole org or critical service=HIGH) and URGENCY (how time-critical: can wait=LOW, " +
    "soon=MEDIUM, work stopped/deadline=HIGH). Derive PRIORITY from impact + urgency and real business " +
    "effect (many people blocked / major incident → HIGH or CRITICAL). Choose the best-fitting " +
    'categoryId and groupId ONLY from the provided id legends (or "none" if truly nothing fits) — do ' +
    "not guess ids. Use the 'similar past tickets' as strong evidence for how THIS organisation routes " +
    "and prioritises comparable issues; stay consistent with that pattern unless the ticket clearly " +
    "differs. Also pick the best-fitting serviceId (the affected business/IT service) ONLY from the " +
    'provided service id legend, or "none" if nothing fits. ALSO review the ticket\'s CURRENT values: ' +
    "if an already-set field (priority, impact, urgency, type, groupId, categoryId or serviceId) is " +
    'clearly WRONG, add its key to "flagged" — but leave "flagged" empty when the current values are ' +
    "reasonable. Keep reasoning to ONE short sentence (max ~16 words); you may cite one ticket ref. " +
    "Do not restate the suggested values, just the why.";

  const prompt = [
    `Allowed priorities: ${PRIORITIES.join(", ")}`,
    `Allowed impact & urgency: ${IMPACT_URGENCY.join(", ")}`,
    `Allowed types: ${TICKET_TYPES.join(", ")} (INCIDENT = something broken, REQUEST = asking for something)`,
    "",
    `Category ids (id: name):\n${catLegend}`,
    "",
    `Team/Group ids (id: name):\n${groupLegend}`,
    "",
    `Service ids (id: name):\n${serviceLegend}`,
    "",
    `Organisation directory (understand teams, services & owners to route well):\n${orgDirectory}`,
    "",
    `Similar past tickets (routing/priority evidence):\n${similarLegend}`,
    "",
    `Current values on the ticket. Type: ${ticket.type}, Priority: ${ticket.priority}, Impact: ${ticket.impact}, Urgency: ${ticket.urgency}, Team: ${curGroup}, Category: ${curCat}, Service: ${curSvc}.`,
    "",
    `Ticket:\n${renderTicket(ticket)}`,
  ].join("\n");

  try {
    const out = await generateAiObject({ system, prompt, schema });

    // Belt-and-suspenders: re-validate ids against the real sets (weaker local
    // models may not hard-enforce the JSON schema).
    const categoryId =
      out.categoryId !== "none" && catIds.includes(out.categoryId) ? out.categoryId : null;
    const groupId =
      out.groupId !== "none" && groupIds.includes(out.groupId) ? out.groupId : null;
    const serviceId =
      out.serviceId !== "none" && serviceIds.includes(out.serviceId) ? out.serviceId : null;

    return {
      ok: true,
      priority: out.priority,
      impact: out.impact,
      urgency: out.urgency,
      type: out.type,
      categoryId,
      groupId,
      serviceId,
      flagged: (out.flagged ?? []) as TriageField[],
      reasoning: plain(out.reasoning),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }
}

/* ── 2. summarizeThread — concise summary of ticket + comments ── */

export type AiTextState = { ok: true; text: string; html: string } | { ok: false; error: string };

export async function summarizeThread(ticketId: number): Promise<AiTextState> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };

  const ticket = await loadTicketContext(ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };

  const system = [
    `You are ${AI_ASSISTANT_NAME}, summarising an ITSM ticket so a support agent gets up to speed in`,
    "seconds. First determine the CURRENT STATE from status/resolution/timing and the discussion:",
    "resolved (and how?), waiting on the customer, blocked, or still in progress?",
    "Then write a tight MARKDOWN summary using these bold labels; skip any that don't apply:",
    "**Problem:** what the requester needs, in one line.",
    "**Done so far:** the key steps already taken, in order (use short bullet points).",
    "**State:** resolved / waiting on customer / blocked / in progress (say which, and since when).",
    "**Next:** the single most useful action to take now.",
    "Be factual and never invent. Keep it short. Reply in the ticket's language. No preamble, no greeting.",
  ].join("\n");

  try {
    const text = await generateAiText({
      system,
      prompt: `Summarise this ticket and its discussion:\n\n${renderTicket(ticket)}`,
    });
    return { ok: true, text, html: renderMarkdown(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }
}

/* ── 3. draftReply — suggested reply draft (language-matching) ── */

export async function draftReply(ticketId: number): Promise<AiTextState> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };

  const ticket = await loadTicketContext(ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };

  const agentName = me.name?.trim() || "the support team";
  const system = [
    `You are ${agentName}, the support agent currently handling this ticket. You are drafting the`,
    "next reply to the requester. Before writing, READ the CURRENT STATE and the whole discussion",
    "and decide what the situation actually calls for:",
    "",
    "- If NO agent has replied to the requester yet (this is the FIRST response): acknowledge and",
    "  thank them, confirm in one or two lines that you understand what they need (for a catalog /",
    "  service request, reference the concrete Request details), and tell them the next step or that",
    "  you're now taking care of it. Do NOT claim any troubleshooting already happened.",
    "- If the ticket is RESOLVED/CLOSED: write a brief confirmation that it's done (summarise the fix",
    "  in one line) and invite them to reply if the issue returns. Do NOT re-open the investigation.",
    "- If the last message was from the AGENT and the requester has NOT replied for a while (see",
    "  'Last message'): write a polite follow-up. If it's been several days, propose closing it, e.g.",
    "  'We haven't heard back from you in a few days, so we'll go ahead and close this ticket. Just",
    "  reply if you still need help.' Match the actual elapsed time from the state.",
    "- If waiting on the requester for specific info: politely ask again for exactly what's missing.",
    "- Otherwise: address the requester's latest message with the concrete next step.",
    "",
    "Base everything ONLY on facts present in the ticket — never invent details or fixes.",
    "Reply in the SAME LANGUAGE as the requester (German if they wrote German). Warm, professional,",
    `concise. Write in the first person as ${agentName} and sign off with that name. Address the`,
    "requester by their name from the ticket, or use a neutral greeting if it isn't given. NEVER",
    "leave a placeholder such as [Name], [Your name] or [Requester]. Output ONLY the message body,",
    "no subject line. You may use light formatting where it genuinely helps (short paragraphs, and",
    "occasionally a short bulleted list or bold key term). It is rendered as rich text, so use",
    "normal markdown, never literal ** or ## in the visible text.",
  ].join("\n");

  try {
    const text = await generateAiText({
      system,
      prompt: `Draft a reply to the requester for this ticket:\n\n${renderTicket(ticket)}`,
    });
    return { ok: true, text, html: renderMarkdown(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }
}

/* ── 4. improveText — improve an agent's typed reply (optional tone) ── */

const TONES = ["neutral", "friendly", "formal", "concise", "apologetic"] as const;
export type Tone = (typeof TONES)[number];

export async function improveText(
  draft: string,
  opts?: { tone?: Tone },
): Promise<AiTextState> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };

  if (plain(draft).length < 2) return { ok: false, error: "Nothing to improve." };

  const tone = opts?.tone && TONES.includes(opts.tone) ? opts.tone : "neutral";

  const system = [
    "You are a text-rewriting engine, NOT a chatbot. You receive a fragment (a word, a selection,",
    "or a whole message) and output an improved version of it.",
    "Rules:",
    "- Output ONLY the rewritten text. No preamble, no explanation, no notes, no quotation marks.",
    "- Fix grammar, spelling, clarity and flow. Keep the SAME meaning, SAME facts, SAME language",
    "  (German stays German), and roughly the same length. Do NOT add greetings, signatures, or",
    "  information the fragment doesn't already contain.",
    `- Apply a ${tone} tone.`,
    "- If the fragment is already fine, or is too short/just a name to change, return it EXACTLY as",
    "  given, unchanged. NEVER respond with commentary like \"No improvement needed\" or \"the text",
    "  appears to be a name\". Returning the input verbatim is always preferred over commenting.",
  ].join("\n");

  try {
    // Low temperature → stay faithful to the input (don't rewrite names, don't drift).
    const text = await generateAiText({ system, prompt: draft, temperature: 0.2 });
    // Safety net: weaker local models sometimes answer with meta-commentary instead
    // of the rewrite. If it looks like a refusal/explanation, keep the original text.
    const final = looksLikeRefusal(text) ? draft.trim() : text;
    return { ok: true, text: final, html: renderMarkdown(final) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }
}

/** Detect the model commenting instead of rewriting (e.g. "No improvement needed…"). */
function looksLikeRefusal(s: string): boolean {
  const t = s.trim().toLowerCase();
  return /^(no (improvement|change|changes|edit)|the (given |provided )?text|this (text|phrase|appears)|it (appears|seems|looks)|i (cannot|can'?t|could ?n'?t|am unable|'m unable)|as an ai|sorry|there (is|are) no|kein[e]? (verbesserung|änderung)|der (gegebene )?text)\b/.test(
    t,
  );
}
