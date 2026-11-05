/**
 * Shared, non-"use server" core for the Sable agent console assistant.
 *
 * This module holds the pieces the streaming route handler
 * (`app/api/assistant/chat/route.ts`) needs: identity resolution, scope coercion, multimodal attachment
 * assembly, the system prompts, proposal derivation, and `prepareAssistantTurn`
 * (everything up to — but not including — the model call).
 *
 * Types live in `lib/actions/ai-assistant.ts` (imported type-only here); the
 * runtime helpers live here so a route handler (which is NOT a "use server"
 * module) can import them without turning them into server actions.
 */

import type { ModelMessage, ToolSet } from "ai";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, hasRole, type Role } from "@/lib/session";
import { getOrgDirectory, getProjectContext } from "@/lib/ai-context";
import { getTicketAiContext } from "@/lib/actions/ai";
import { loadAccessibleProject } from "@/lib/ai-projects";
import { getSetting } from "@/lib/settings";
import { buildAssistantGeneralTools } from "@/lib/assistant-tools";
import { ASSISTANT_ADMIN_TOOLS } from "@/lib/ai-admin-tools";
import { buildOperationTools } from "@/lib/ai-operations/tools";
import { findOperation } from "@/lib/ai-operations/registry";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { INLINE_BADGE_NAMESPACES } from "@/lib/inline-badge";
import type {
  AssistantScope,
  AssistantAttachment,
  UploadedAttachment,
  AssistantProposal,
} from "@/lib/actions/ai-assistant";

/* ────────────────────────────────────────────────────────────────────────────
 * Identity & scope.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ActingAgent = { id: string; name: string; email: string; role: Role };

/**
 * The acting user with a FRESH role from the DB (not the possibly-stale JWT).
 * Every RBAC decision authorises off this, never the session role. Returns null
 * if not signed in, inactive, or below AGENT.
 */
export async function getActingAgent(): Promise<ActingAgent | null> {
  const row = await getCurrentUser();
  if (!row || !row.isActive || !isAgent(row.role as Role)) return null;
  return {
    id: row.id,
    name: row.name ?? row.email ?? "User",
    email: row.email ?? "",
    role: row.role as Role,
  };
}

/** Normalise a persisted scope string to the union (defence in depth). */
export function coerceScope(raw: string): AssistantScope {
  return raw === "ADMIN" ? "ADMIN" : "GENERAL";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Proposals — turn propose_* tool calls into approval cards.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Turn Sable's propose_* tool calls into approval cards. Each write tool maps (via
 * writeToolToOpId, built alongside the tools) to a registry operation id; we look
 * up the op to compute the card label. Only calls whose args pass the op's schema
 * become proposals (the live tool refused the others, so no card was shown), and
 * they keep the parsed args and their tool call id, exactly like the live card.
 * Not deduped: every call is its own proposal with its own decision.
 */
export function buildAssistantProposals(
  toolCalls: { id?: string; name: string; input: unknown }[],
  writeToolToOpId: Map<string, string>,
): AssistantProposal[] {
  const out: AssistantProposal[] = [];
  toolCalls.forEach((tc, i) => {
    const operationId = writeToolToOpId.get(tc.name);
    if (!operationId) return;
    const op = findOperation(operationId);
    if (!op) return;
    const parsed = op.input.safeParse(tc.input ?? {});
    if (!parsed.success) return;
    const args = parsed.data as Record<string, unknown>;
    out.push({
      id: `pr${i}`,
      operationId,
      args,
      label: op.label ? op.label(args) : operationId,
      ...(tc.id ? { toolCallId: tc.id } : {}),
    });
  });
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * System prompts.
 * ──────────────────────────────────────────────────────────────────────────── */

export function generalSystemPrompt(input: {
  orgName: string;
  orgDirectory: string;
  meName: string;
  meRole: string;
  now?: Date;
}): string {
  const { orgName, orgDirectory, meName, meRole, now = new Date() } = input;
  return [
    `You are ${AI_ASSISTANT_NAME}, the AI assistant built into ${orgName}, an IT service`,
    "management system. You are an experienced ITSM engineer: knowledgeable, concise,",
    "specific, a real teammate. This is a standalone chat (not tied to one ticket).",
    "",
    `NOW: ${now.toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    "(server local time). Resolve relative or year-less dates (\"Saturday 14.11.\") against it.",
    "",
    "WHO YOU ARE HELPING:",
    `${meName || "An agent"} (role ${meRole}). Treat them as a trusted colleague. When`,
    `they say "we" or "our team", they mean ${orgName}'s IT / support staff, not an end user.`,
    "",
    "CRITICAL: You and this agent ARE the IT / service desk. Never suggest \"contact IT\" or",
    "\"escalate to IT\" — there is no external IT. Name a SPECIFIC team, service owner, or",
    "record from the directory. Be concrete, never generic.",
    "",
    "TOOLS you can call (prefer internal sources over the open web, and cite what you use):",
    "- list_my_tickets: the tickets assigned to THIS agent — their personal work queue. Use it",
    "  whenever they ask about \"my tickets\", \"what am I working on\", \"what's assigned to me\".",
    "- list_team_tickets: open/unassigned tickets in the agent's own team(s) — work they can pick up.",
    "- list_tickets: structured filters (assignee me/unassigned, status, priority, team).",
    "- get_ticket: full details of ONE ticket by ref/number (SLA due dates, requester, latest comments)",
    "  so you can help them actually work it. Look a ticket up before advising on it.",
    "- search_knowledge_base: the org's own how-to / troubleshooting articles. Try this first.",
    "- search_tickets / search_problems / search_changes: free-text search of existing records (incl. comments).",
    "- web_search / fetch_url: the public web, only for facts not documented internally.",
    "- draft_document: for a LONG free-standing document (a runbook, RCA or KB draft) call this with the",
    "  full markdown to open an editable canvas beside the chat where the user can refine and publish it.",
    "  NEVER use it for a record the user asked you to create or change (a change, problem, ticket): put",
    "  the content into the propose_* tool's own fields so the record itself is complete.",
    "  When the user asks for a SCRIPT or a file, call draft_document (pass `filename`/`language`, e.g.",
    "  'deploy.sh'/'bash') to open that editable canvas, which the user can then save into the project's files.",
    "  For a SCRIPT, put ONLY the code in `markdown` as a SINGLE fenced code block — no prose, no",
    "  commentary, and no 'alternative' variants (one script only); use in-code comments for any notes.",
    "  To WRITE or CREATE a KNOWLEDGE BASE ARTICLE, ALWAYS use draft_document (it opens the canvas; the",
    "  user reviews and clicks 'Save as KB article' to publish). Do NOT use a create-article tool for",
    "  authoring — only if the user explicitly asks to publish immediately without reviewing a draft.",
    "",
    "FORMATTING — write bodies, comments and descriptions in MARKDOWN: separate paragraphs with a BLANK",
    "line, use '- ' bullet lists and '1.' numbered lists, '**bold**' and headings where helpful. They are",
    "rendered as rich text, so real line breaks and lists matter — never return one unbroken block.",
    "In CHAT replies: keep paragraphs to 2-3 sentences, prefer short bullet lists over long prose, and",
    "NEVER write internal tool or field names (list_my_tickets, propose_ticket_escalate, breached:false):",
    "say what you did or can do in plain words (\"I looked up your tickets\", \"I can propose an escalation\").",
    "Use a hyphen or a comma instead of an em-dash; keep normal letters (German umlauts stay ä, ö, ü).",
    "Say each thing once: after a proposal, close with 2-4 short bullets (assumptions, open points),",
    "do not repeat the analysis you already gave above the approval card.",
    "STATUS BADGES: write a record's state as namespaced inline code, ALWAYS wrapped in backticks, and it",
    "renders as a coloured badge, e.g. `status:OPEN`, `priority:HIGH`, `sla:BREACHED`, `change:SCHEDULED`,",
    `\`risk:MEDIUM\`. Namespaces: ${INLINE_BADGE_NAMESPACES.join(", ")}. Use the exact enum value; never`,
    "write a state as a bare word or without the backticks. Badges are ONLY for these enum states (`sla:`",
    "is the clock state ON_TRACK/AT_RISK/BREACHED/MET/PAUSED); names such as an SLA policy, team or",
    "category stay plain text. Write record refs as inline code (`INC-0142`, `PRB-0019`, `CHG-0039`):",
    "they render as links to the record.",
    "",
    "ACCURACY — never invent data. Do NOT fabricate category, team, user, service or asset names (a",
    "common mistake is guessing a category like 'Network > VPN' — categories are single names, and the",
    "real one may just be 'VPN'). BEFORE you set a category or route to a team in a proposal, CALL the",
    "matching read tool (category_list, group_list, or the search tools) and use one of the REAL returned",
    "names verbatim. If nothing fits, or you can't verify it, LEAVE THE FIELD UNSET rather than guessing —",
    "an omitted field is fine, a made-up one is not. If you don't know something, say so or look it up; do",
    "not present a guess as fact.",
    "",
    "ACTIONS — you have many `propose_*` tools to change the system, scoped to what your role",
    "permits: create/update tickets, add comments, resolve, escalate, link, add tasks, log work;",
    "and create categories, services, assets, locations, and more. Refer to teams / categories",
    "/ users by their real NAMES (the tools resolve names to records). These ONLY PROPOSE: each",
    "surfaces an approval card the human confirms — nothing is applied on its own, so use them",
    "freely. Propose each distinct change EXACTLY ONCE. IMPORTANT: you CANNOT apply anything",
    "yourself. In your reply, say you have PROPOSED the change(s) for approval below. NEVER say a",
    "change is \"done\", \"applied\", \"created\" or \"approved\".",
    "",
    "ATTACHMENTS: if the user attached screenshot(s)/file(s) this turn and you propose creating a",
    "ticket or adding a comment, those files are linked to that ticket automatically on approval.",
    "Set attachFiles=false on that call ONLY if the attachment isn't relevant to it.",
    "",
    "Keep answers tight; use short markdown (bold, lists, links). Reply in the user's language.",
    "",
    "ORGANISATION DIRECTORY (real teams, services and categories):",
    orgDirectory,
  ].join("\n");
}

/**
 * Admin capabilities block, APPENDED to the general prompt when the acting user
 * is an ADMIN (rather than swapping to a separate admin-only prompt that would
 * hide the general guidance). Covers stats / settings / system-wide config ops.
 */
export function adminSystemPromptSection(): string {
  return [
    "",
    "ADMIN CAPABILITIES (you are talking to a system administrator — these are also available):",
    "- PULL STATISTICS with get_statistics. Available metrics: tickets_by_status,",
    "  tickets_by_priority, tickets_by_team, tickets_by_category, open_tickets,",
    "  tickets_created, tickets_resolved, sla_breaches, users_by_role, counts_overview.",
    "  (optional groupBy, timeframeDays). Use it to answer \"how many…\", \"how is X trending\",",
    "  \"which team has the most open tickets\", etc. Report numbers plainly (short tables/lists).",
    "  Never invent metrics — always call get_statistics for numbers.",
    "- REVIEW CONFIG with get_settings_overview (shows non-secret settings and whether secrets",
    "  are configured). NEVER reveal or ask for secret values (API keys, passwords, encryption",
    "  keys); you can see only whether they are set, never their contents. Never print a secret.",
    "- LOOK UP people, groups, categories and services (search_people/groups/categories/services).",
    "- SYSTEM-WIDE `propose_*` ACTIONS: manage groups/teams, services, catalog items, SLAs,",
    "  problems, changes, USER ROLES, and app SETTINGS (NON-SECRET keys only — you can never read",
    "  or set secrets like API keys / passwords / encryption keys). These follow the same",
    "  propose-then-approve rule as every other action.",
  ].join("\n");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Attachments — turn uploaded files into multimodal model content.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB per file (post-downscale for images)
const MAX_FILE_TEXT_CHARS = 6000; // how much of a text file we inline per file
const MAX_IMAGE_PARTS = 4; // cap images actually sent to the model

/** Text-ish files we can decode and inline verbatim for any model (no vision needed). */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "log", "yml", "yaml", "xml",
  "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "java", "sql", "sh",
  "env", "ini", "toml", "conf", "rb", "go", "rs", "php", "c", "cpp", "h",
]);

function isImage(type: string) {
  return type.startsWith("image/");
}
function isTextLike(name: string, type: string) {
  if (type.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/x-yaml", "application/csv"].includes(type)) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

/** Decode the base64 payload of a data URL to a UTF-8 string (server-side). */
function decodeDataUrlText(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Buffer.from(b64, "base64").toString("utf8");
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type BuiltContent = {
  /** Multimodal content parts (text + image/file parts) for a vision-capable model. */
  parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string }
    | { type: "file"; data: string; mediaType: string }
  >;
  /** Plain-text-only fallback (for models that can't take images/files). */
  text: string;
  /** Metadata for persistence / transcript re-render. */
  meta: AssistantAttachment[];
  hasBinaryParts: boolean;
};

/**
 * Turn the user's text + uploaded attachments into model content:
 * - images  → image parts (a vision model reads them) + a note
 * - text files → decoded and inlined (works for ANY model)
 * - PDFs   → file parts (Anthropic/OpenAI read them) + a note
 * - other  → a note naming the file so the model can acknowledge it
 * Also returns a text-only fallback used if the model rejects binary parts.
 */
export function buildUserContent(text: string, uploads: UploadedAttachment[]): BuiltContent {
  const parts: BuiltContent["parts"] = [];
  const meta: AssistantAttachment[] = [];
  const textBlocks: string[] = text ? [text] : [];
  const notes: string[] = [];
  let imageCount = 0;
  let hasBinaryParts = false;

  for (const a of uploads) {
    if (isImage(a.type)) {
      meta.push({ name: a.name, type: a.type, size: a.size, kind: "image", dataUrl: a.dataUrl });
      notes.push(`- image: ${a.name}`);
      if (imageCount < MAX_IMAGE_PARTS) {
        parts.push({ type: "image", image: a.dataUrl });
        imageCount++;
        hasBinaryParts = true;
      }
    } else if (isTextLike(a.name, a.type)) {
      meta.push({ name: a.name, type: a.type, size: a.size, kind: "file" });
      let body = "";
      try {
        body = decodeDataUrlText(a.dataUrl).slice(0, MAX_FILE_TEXT_CHARS);
      } catch {
        body = "(could not read file)";
      }
      textBlocks.push(
        `\n\n[Attached file: ${a.name} (${a.type || "text"}, ${humanSize(a.size)})]\n"""\n${body}\n"""`,
      );
    } else if (a.type === "application/pdf") {
      meta.push({ name: a.name, type: a.type, size: a.size, kind: "file" });
      notes.push(`- document: ${a.name} (PDF)`);
      parts.push({ type: "file", data: a.dataUrl, mediaType: "application/pdf" });
      hasBinaryParts = true;
    } else {
      meta.push({ name: a.name, type: a.type, size: a.size, kind: "file" });
      notes.push(`- file: ${a.name} (${a.type || "unknown"}) — attached, not machine-readable here`);
    }
  }

  if (notes.length) {
    textBlocks.push(`\n\nThe user attached:\n${notes.join("\n")}`);
  }

  const combinedText = textBlocks.join("").trim() || "(no message)";
  parts.unshift({ type: "text", text: combinedText });

  return { parts, text: combinedText, meta, hasBinaryParts };
}

/** Sanitise raw client attachments (bound count + size; drop anything malformed). */
export function sanitizeUploads(raw: unknown): UploadedAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a) =>
        a &&
        typeof a.dataUrl === "string" &&
        a.dataUrl.startsWith("data:") &&
        a.dataUrl.length < MAX_ATTACHMENT_BYTES * 1.4 && // base64 overhead
        typeof a.name === "string",
    )
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({
      name: String(a.name).slice(0, 200),
      type: String(a.type ?? ""),
      size: Number.isFinite(a.size) ? Number(a.size) : 0,
      dataUrl: a.dataUrl as string,
    }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * prepareAssistantTurn — everything up to (not including) the model call.
 * ──────────────────────────────────────────────────────────────────────────── */

export type PreparedTurn = {
  conv: { id: string; scope: AssistantScope };
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  writeToolToOpId: Map<string, string>;
  built: BuiltContent;
  title: string;
  /** True when the last user message carries image/PDF parts (for text-only retry). */
  hasBinaryParts: boolean;
};

/**
 * Authorise the conversation, persist the user turn, auto-title, load bounded
 * history, and assemble system + messages + tools. Throws on auth/config errors (the caller maps to an HTTP
 * status); the assistant turn itself is persisted by the caller after streaming.
 */
export async function prepareAssistantTurn(input: {
  me: ActingAgent;
  conversationId: string;
  content: string;
  uploads: UploadedAttachment[];
  context?: { ticketId?: number; projectId?: string };
}): Promise<PreparedTurn> {
  const { me, uploads } = input;
  const content = String(input.content ?? "").trim();

  const conv = await db.aiConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, userId: true, scope: true, title: true, projectId: true },
  });
  if (!conv || conv.userId !== me.id) throw new Error("Not authorised");

  const scope = coerceScope(conv.scope);
  if (scope === "ADMIN" && !hasRole(me.role, "ADMIN")) throw new Error("Not authorised");

  const built = buildUserContent(content, uploads);

  // Persist the user turn first (so the conversation survives an AI failure).
  const displayContent =
    content || built.meta.map((m) => m.name).join(", ") || "(attachment)";
  await db.aiMessage.create({
    data: { conversationId: conv.id, role: "user", content: displayContent },
  });

  // Auto-title from the first user message.
  let title = conv.title;
  if (title === "New chat") {
    const seed =
      content.replace(/\s+/g, " ").trim() ||
      (built.meta[0]?.name ? `Re: ${built.meta[0].name}` : "");
    title = seed.slice(0, 60) || "New chat";
    await db.aiConversation.update({ where: { id: conv.id }, data: { title } });
  }

  // Bounded model history from the DB.
  const rows = await db.aiMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const recent = rows.slice(-16);
  const messages: ModelMessage[] = recent.map((m) =>
    m.role === "assistant"
      ? { role: "assistant", content: m.content }
      : { role: "user", content: m.content },
  );
  // Replace the just-added final user turn with the FULL content for this turn.
  if (messages.length > 0) {
    messages[messages.length - 1] = built.hasBinaryParts
      ? ({ role: "user", content: built.parts } as ModelMessage)
      : ({ role: "user", content: built.text } as ModelMessage);
  }

  const orgName = (await getSetting("APP_NAME")) || "Servio";
  const orgDirectory = await getOrgDirectory();

  const memberships = await db.groupMember.findMany({
    where: { userId: me.id },
    select: { groupId: true },
  });
  const readTools = buildAssistantGeneralTools({
    userId: me.id,
    name: me.name,
    groupIds: memberships.map((m) => m.groupId),
  });
  // Admin read tools + system-wide config ops are gated by the acting user's
  // ROLE (fresh from the DB), not by a separate chat scope — so an admin sees
  // admin capabilities directly in the normal chat; a non-admin never does.
  const isAdmin = hasRole(me.role, "ADMIN");
  const adminReadTools = isAdmin ? ASSISTANT_ADMIN_TOOLS : {};

  // If the chat is pinned to a project the acting user can access, thread its id
  // into the op ctx so project.search_files/list_files resolve to that library.
  // Prefer the explicit in-context project; fall back to the conversation's own
  // pinned project (e.g. a chat created via "New chat in project") so it grounds
  // even when the window's active project differs.
  let projectId: string | undefined;
  const rawProjectId =
    (typeof input.context?.projectId === "string" && input.context.projectId) || conv.projectId || "";
  if (rawProjectId) {
    const access = await loadAccessibleProject({ id: me.id, role: me.role }, rawProjectId);
    if (access) projectId = rawProjectId;
  }

  const { tools: opTools, writeToolToOpId } = buildOperationTools(
    { userId: me.id, role: me.role, name: me.name, projectId },
    scope,
  );
  const tools = { ...readTools, ...adminReadTools, ...opTools };

  // Always the general prompt; for admins, APPEND the admin capabilities block
  // (rather than swapping to an admin-only prompt that hides general guidance).
  let system = generalSystemPrompt({ orgName, orgDirectory, meName: me.name, meRole: me.role });
  if (isAdmin) system += "\n" + adminSystemPromptSection();

  const ctxTicketId = Number(input.context?.ticketId);
  if (Number.isInteger(ctxTicketId) && ctxTicketId > 0) {
    const ticketContext = await getTicketAiContext(ctxTicketId);
    if (ticketContext) {
      system +=
        "\n\nCURRENT TICKET (the user is viewing this — treat \"this ticket\"/\"it\" as this one, and " +
        "use its ref for ticket tools; you may draft a KB article from its problem + resolution):\n" +
        ticketContext;
    }
  }

  // If the chat is pinned to a project, append its context so the model grounds
  // answers in the project's instructions, bound records, and files.
  if (projectId) {
    const projectContext = await getProjectContext(projectId, me.id);
    if (projectContext) {
      system +=
        "\n\nCURRENT PROJECT (this chat is pinned to it — honour its INSTRUCTIONS, treat its " +
        "BOUND RECORDS as the subject, and call project.search_files to ground answers in its files " +
        "rather than guessing):\n" +
        projectContext;
    }
  }

  return {
    conv: { id: conv.id, scope },
    system,
    messages,
    tools,
    writeToolToOpId,
    built,
    title,
    hasBinaryParts: built.hasBinaryParts,
  };
}
