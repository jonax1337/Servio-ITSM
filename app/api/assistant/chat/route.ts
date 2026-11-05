import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ToolSet,
  type UIMessage,
} from "ai";
import { beginRun } from "@/lib/sable-active-runs";
import { db } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { aiConfigured, streamAiChat } from "@/lib/ai";
import { AgentTranscript, pipeAgentRun } from "@/lib/claude-agent-events";
import {
  getActingAgent,
  prepareAssistantTurn,
  buildAssistantProposals,
  sanitizeUploads,
  type PreparedTurn,
} from "@/lib/assistant-core";
import { checkAiRate } from "@/lib/rate-limit";
import { resolveRemoteMcp } from "@/lib/sable-mcp";
import { stageDataUrls, deleteStagedAttachments } from "@/lib/attachment-intake";
import type { AssistantProposal, UploadedAttachment } from "@/lib/actions/ai-assistant";

/** Operations that accept the turn's attachments linked onto their ticket. */
const ATTACHABLE_OPS = new Set(["ticket.create", "ticket.comment"]);

/**
 * Set the turn's staged attachment ids on a ticket.create / ticket.comment
 * proposal's args (unless the model opted out with attachFiles). Returns true
 * if the proposal took the attachments.
 *
 * attachmentIds is SERVER-controlled: never trust a model-supplied value —
 * strip it unconditionally, then set only the ids we staged this turn. (Even if
 * a value slipped through to approval, linkStagedAttachments only ever
 * re-parents the acting user's OWN still-unparented files, so it's inert.)
 */
function applyStagedIds(args: Record<string, unknown>, stagedIds: string[]): boolean {
  delete args.attachmentIds;
  if (!stagedIds.length || args.attachFiles === false) return false;
  args.attachmentIds = stagedIds;
  return true;
}

/**
 * Wrap the attachable propose_* tools so the staged ids are injected BEFORE the
 * proposal is built: the approval card is streamed live from the tool result,
 * so the ids must already be in it (applyAssistantProposal re-validates the
 * client args at approval time). `used()` tells whether any proposal took them.
 */
function withStagedAttachments(
  tools: ToolSet,
  writeToolToOpId: Map<string, string>,
  stagedIds: string[],
): { tools: ToolSet; used(): boolean } {
  let used = false;
  const wrapped: ToolSet = { ...tools };
  for (const [name, t] of Object.entries(tools)) {
    const execute = t.execute;
    if (!execute || !ATTACHABLE_OPS.has(writeToolToOpId.get(name) ?? "")) continue;
    wrapped[name] = {
      ...t,
      execute: (args: Record<string, unknown>, options) => {
        const withIds = { ...args };
        if (applyStagedIds(withIds, stagedIds)) used = true;
        return execute(withIds, options);
      },
    } as typeof t;
  }
  return { tools: wrapped, used: () => used };
}

/** Mirror the injection on the recorded tool calls, so the persisted proposals match. */
function stampStagedIds(
  toolCalls: { name: string; input: unknown }[],
  writeToolToOpId: Map<string, string>,
  stagedIds: string[],
): void {
  for (const tc of toolCalls) {
    if (!ATTACHABLE_OPS.has(writeToolToOpId.get(tc.name) ?? "")) continue;
    const args = { ...((tc.input ?? {}) as Record<string, unknown>) };
    applyStagedIds(args, stagedIds);
    tc.input = args;
  }
}

/**
 * Streaming chat turn for the unified console Sable (the global window: min & max
 * share this endpoint). Server-authoritative: it ignores any client-side message
 * history and rebuilds context from the DB via `prepareAssistantTurn`, then
 * streams the agent run LIVE through the Claude Code harness: thinking, every
 * tool call and its result, and the text between steps. propose_* tool results
 * carry the proposal, so approval cards appear inline as the agent proposes.
 *
 * The persisted assistant turn and the proposals metadata are computed once the
 * run ends.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FALLBACK_ERROR = "The AI request failed.";

/** Message metadata sent to the client (approval cards + read-tool activity). */
type SableMetadata = {
  proposals?: ReturnType<typeof buildAssistantProposals>;
  toolCalls?: { name: string; input: unknown }[];
};

/** A cited source Sable grounded on this turn (web page, KB article, project file). */
type SourceRef = { label: string; url: string; kind: "web" | "kb" | "file" };

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) URLs are safe to render as an external link (blocks javascript:,
 *  data:, etc. coming from an untrusted search provider). */
function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extract citable sources from a turn's tool results — the web pages searched,
 * KB articles and project files consulted — so we can show a "Sources" panel
 * under the answer. Robust to the various result shapes; de-duped by URL.
 */
function collectSources(
  toolCalls: { name: string; input: unknown }[],
  toolResults: { name: string; output: unknown }[],
): SourceRef[] {
  const asArr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  const out: SourceRef[] = [];
  for (const r of toolResults) {
    if (r.name === "web_search") {
      for (const h of asArr(r.output)) {
        const url = typeof h.url === "string" ? h.url : "";
        // The URL is from an external search provider — only trust http(s).
        if (url && isHttpUrl(url)) out.push({ label: (typeof h.title === "string" && h.title) || safeHostname(url), url, kind: "web" });
      }
    } else if (r.name === "search_knowledge_base" || r.name === "search_knowledge") {
      for (const h of asArr(r.output)) {
        const url = typeof h.url === "string" ? h.url : "";
        if (url) out.push({ label: (typeof h.title === "string" && h.title) || url, url, kind: "kb" });
      }
    } else if (r.name === "project_search_files") {
      for (const h of asArr((r.output as { hits?: unknown })?.hits)) {
        const id = typeof h.fileId === "string" ? h.fileId : "";
        if (id) out.push({ label: (typeof h.file === "string" && h.file) || "file", url: `/api/files/${id}`, kind: "file" });
      }
    }
  }
  for (const c of toolCalls) {
    if (c.name !== "fetch_url") continue;
    const u = (c.input as { url?: unknown })?.url;
    if (typeof u === "string" && isHttpUrl(u)) out.push({ label: safeHostname(u), url: u, kind: "web" });
  }
  const seen = new Set<string>();
  const deduped: SourceRef[] = [];
  for (const s of out) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    deduped.push(s);
    if (deduped.length >= 12) break;
  }
  return deduped;
}

/** Persist the finished assistant turn (mirrors the legacy sendMessage write). */
async function persistAssistant(
  convId: string,
  text: string,
  rawToolCalls: { name: string; input: unknown }[],
  proposals: AssistantProposal[],
) {
  const answer = text.trim() || "(no answer)";
  const html = renderMarkdown(answer);
  await db.aiMessage.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content: answer,
      html,
      toolCalls: JSON.stringify(rawToolCalls),
      // decisionTracked: applies to this proposal are recorded, so a reload may offer it again.
      proposals: proposals.length ? JSON.stringify(proposals.map((p) => ({ ...p, decisionTracked: true }))) : null,
    },
  });
  // Bump updatedAt so the rail re-sorts this conversation to the top.
  await db.aiConversation.update({ where: { id: convId }, data: {} });
}

/** Extract the new turn (text + attachments) from a client UI user message. */
function extractTurn(message: UIMessage | undefined): { content: string; uploads: UploadedAttachment[] } {
  const parts = message?.parts ?? [];
  const content = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
  // Attachments arrive as `file` parts (url + mediaType) or, depending on the
  // wire shape, `image` parts (image field) — accept both.
  const uploads = parts
    .map((p) => {
      const fp = p as { type: string; mediaType?: string; filename?: string; url?: string; image?: string };
      const dataUrl = String(fp.url ?? fp.image ?? "");
      if (!dataUrl.startsWith("data:")) return null;
      const type = fp.mediaType ?? (fp.type === "image" ? "image/png" : "");
      return { name: fp.filename ?? "file", type, size: 0, dataUrl };
    })
    .filter((u): u is UploadedAttachment => u !== null);
  return { content, uploads };
}

export async function POST(req: Request) {
  const me = await getActingAgent();
  if (!me) return new Response("Not authorised", { status: 401 });

  const limited = checkAiRate(me.id);
  if (limited) {
    return new Response("Too many AI requests — slow down a little.", {
      status: 429,
      headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
    });
  }

  if (!(await aiConfigured())) {
    return new Response("AI is not configured.", { status: 400 });
  }

  let body: {
    conversationId?: string;
    messages?: UIMessage[];
    context?: { ticketId?: number; projectId?: string };
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "");
  if (!conversationId) return new Response("Missing conversationId", { status: 400 });

  // Sanitise the in-context surface passed to prepareAssistantTurn: a numeric
  // ticketId and/or a bounded project id (a cuid; access is re-checked upstream).
  const rawCtx = body.context ?? {};
  const rawProjectId = typeof rawCtx.projectId === "string" ? rawCtx.projectId.slice(0, 64) : undefined;
  const context = {
    ticketId: rawCtx.ticketId,
    ...(rawProjectId ? { projectId: rawProjectId } : {}),
  };

  // assistant-ui / useChat posts the full messages array; the new turn is the
  // last user message. We rebuild history server-side from the DB regardless.
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const { content, uploads: rawUploads } = extractTurn(lastUser);
  const uploads = sanitizeUploads(rawUploads);
  if (!content && uploads.length === 0) {
    return new Response("Nothing to send.", { status: 400 });
  }

  // Reserve the run BEFORE the question is saved: from then on a client that sees
  // the question can rejoin or stop its answer (lib/sable-active-runs). The owner
  // check comes first so nobody can reserve, and so block, another user's chat.
  const owner = await db.aiConversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
  if (owner?.userId !== me.id) return new Response("Not authorised", { status: 403 });
  // The run outlives this request: leaving or reloading the chat only drops this
  // subscriber; the Stop button aborts it explicitly.
  const runAbort = new AbortController();
  const pending = beginRun(conversationId, me.id, runAbort);
  if (!pending) return new Response("Sable is still answering in this chat.", { status: 409 });

  let prepared: PreparedTurn;
  try {
    prepared = await prepareAssistantTurn({
      me,
      conversationId,
      content,
      uploads,
      context,
    });
  } catch (e) {
    pending.discard();
    const msg = e instanceof Error ? e.message : "Could not prepare the chat.";
    return new Response(msg, { status: msg === "Not authorised" ? 403 : 400 });
  }

  // Stage the turn's uploads as real (unparented) attachments so their ids can be
  // injected into a ticket.create/comment proposal and survive to approval time.
  // Anything not taken by a proposal is cleaned up once the turn resolves.
  let stagedIds: string[];
  try {
    stagedIds = uploads.length ? await stageDataUrls(me.id, uploads) : [];
  } catch (e) {
    pending.discard();
    throw e;
  }
  const staged = withStagedAttachments(prepared.tools, prepared.writeToolToOpId, stagedIds);

  const stream = createUIMessageStream<UIMessage<SableMetadata>>({
    execute: async ({ writer }) => {
      const transcript = new AgentTranscript();
      // Remote MCP servers this user's role may use (none unless AI_ALLOW_EXTERNAL).
      const remoteMcp = await resolveRemoteMcp(me.role);
      const run = streamAiChat({
        system: prepared.system,
        messages: prepared.messages,
        tools: staged.tools,
        remoteMcp: remoteMcp ?? undefined,
        audience: "console",
        maxSteps: 10,
        abortSignal: runAbort.signal,
      });
      await pipeAgentRun(run, { writer, transcript, fallbackError: FALLBACK_ERROR, abortSignal: runAbort.signal });

      const toolCalls = transcript.toolCalls;
      stampStagedIds(toolCalls, prepared.writeToolToOpId, stagedIds);
      if (stagedIds.length && !staged.used()) await deleteStagedAttachments(me.id, stagedIds);

      // Sources panel: the web pages / KB / files this turn grounded on, emitted
      // as a synthetic `cited_sources` tool part AFTER the answer so it renders
      // as a tidy "Sources" row at the end.
      const sources = collectSources(toolCalls, transcript.toolResults);
      if (sources.length) {
        writer.write({ type: "tool-input-available", toolCallId: "sources", toolName: "cited_sources", input: {} });
        writer.write({ type: "tool-output-available", toolCallId: "sources", output: { sources } });
      }
      const proposals = [
        ...buildAssistantProposals(toolCalls, prepared.writeToolToOpId),
        ...(remoteMcp?.proposals() ?? []),
      ];
      writer.write({ type: "message-metadata", messageMetadata: { proposals, toolCalls } });
      await persistAssistant(prepared.conv.id, transcript.text, toolCalls, proposals);
    },
    onError: (e) => (e instanceof Error ? e.message : FALLBACK_ERROR),
  });
  return createUIMessageStreamResponse({ stream: pending.attach(stream) });
}
