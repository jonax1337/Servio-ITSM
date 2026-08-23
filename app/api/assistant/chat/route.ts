import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { db } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { aiConfigured, currentProvider, resolveChatModel, chatMaxOutputTokens, generateAiChat } from "@/lib/ai";
import {
  getActingAgent,
  prepareAssistantTurn,
  buildAssistantProposals,
  sanitizeUploads,
  type PreparedTurn,
} from "@/lib/assistant-core";
import { findOperation } from "@/lib/ai-operations/registry";
import { checkAiRate } from "@/lib/rate-limit";
import { stageDataUrls, deleteStagedAttachments } from "@/lib/attachment-intake";
import type { UploadedAttachment } from "@/lib/actions/ai-assistant";

/** Operations that accept the turn's attachments linked onto their ticket. */
const ATTACHABLE_OPS = new Set(["ticket.create", "ticket.comment"]);

/**
 * Inject the turn's staged attachment ids into the args of any ticket.create /
 * ticket.comment proposal the model made (unless it opted out with attachFiles).
 * Mutating the raw tool inputs makes the ids flow into the streamed proposal,
 * the message metadata AND the persisted proposal uniformly, so they survive to
 * approval time (applyAssistantProposal re-validates the client args). Returns
 * true if at least one proposal took the attachments.
 */
function injectStagedAttachments(
  rawToolCalls: { name: string; input: unknown }[],
  writeToolToOpId: Map<string, string>,
  stagedIds: string[],
): boolean {
  let used = false;
  for (const tc of rawToolCalls) {
    if (!ATTACHABLE_OPS.has(writeToolToOpId.get(tc.name) ?? "")) continue;
    const input = (tc.input ?? {}) as Record<string, unknown>;
    // attachmentIds is SERVER-controlled: never trust a model-supplied value —
    // strip it unconditionally, then set only the ids we staged this turn. (Even
    // if a value slipped through to approval, linkStagedAttachments only ever
    // re-parents the acting user's OWN still-unparented files, so it's inert.)
    delete input.attachmentIds;
    if (stagedIds.length && input.attachFiles !== false) {
      input.attachmentIds = stagedIds;
      used = true;
    }
    tc.input = input;
  }
  return used;
}

/**
 * Streaming chat turn for the unified console Sable (the global window: min & max
 * share this endpoint). Server-authoritative: it ignores any client-side message
 * history and rebuilds context from the DB via `prepareAssistantTurn`, then
 * streams the assistant reply token-by-token.
 *
 * - ai-sdk providers (anthropic/openai/ollama) → `streamText` → UI message stream.
 * - claude-code (subscription CLI) → buffered `generateAiChat`, emitted as a
 *   single UI message stream so the client stays uniform.
 *
 * Proposals (propose_* tool calls → approval cards) and the persisted assistant
 * turn are computed on finish; proposals ride to the client as message metadata.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TEXT_ID = "t0";

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
  writeToolToOpId: Map<string, string>,
) {
  const answer = text.trim() || "(no answer)";
  const html = renderMarkdown(answer);
  const proposals = buildAssistantProposals(rawToolCalls, writeToolToOpId);
  await db.aiMessage.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content: answer,
      html,
      toolCalls: JSON.stringify(rawToolCalls),
      proposals: proposals.length ? JSON.stringify(proposals) : null,
    },
  });
  // Bump updatedAt so the rail re-sorts this conversation to the top.
  await db.aiConversation.update({ where: { id: convId }, data: {} });
}

/** Concatenate the text parts of a finished UI assistant message. */
function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
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
    const msg = e instanceof Error ? e.message : "Could not prepare the chat.";
    return new Response(msg, { status: msg === "Not authorised" ? 403 : 400 });
  }

  const provider = await currentProvider();

  // Stage the turn's uploads as real (unparented) attachments so their ids can be
  // injected into a ticket.create/comment proposal and survive to approval time.
  // Anything not taken by a proposal is cleaned up once the turn resolves.
  const stagedIds = uploads.length ? await stageDataUrls(me.id, uploads) : [];

  /* ── claude-code: buffered, emitted as a single uniform UI message stream ── */
  if (provider === "claude-code") {
    const stream = createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        let text = "(no answer)";
        let rawToolCalls: { name: string; input: unknown }[] = [];
        let rawToolResults: { name: string; output: unknown }[] = [];
        try {
          const result = await generateAiChat({
            system: prepared.system,
            messages: prepared.messages,
            tools: prepared.tools,
            maxSteps: 10,
          });
          text = result.text || "(no answer)";
          rawToolCalls = result.toolCalls ?? [];
          rawToolResults = result.toolResults ?? [];
        } catch (e) {
          text = e instanceof Error ? `⚠️ ${e.message}` : "⚠️ The AI request failed.";
        }
        // Attach the turn's staged files to any ticket create/comment proposal,
        // then drop the staged rows if nothing took them.
        const usedStaged = injectStagedAttachments(rawToolCalls, prepared.writeToolToOpId, stagedIds);
        if (stagedIds.length && !usedStaged) await deleteStagedAttachments(me.id, stagedIds);
        // The buffered CLI path has no native tool streaming — synthesise the
        // tool parts so assistant-ui renders read-tool activity + the
        // approve-first proposal cards. Order = read tools → answer → proposals,
        // so the approval cards sit BELOW the assistant's reply.
        rawToolCalls.forEach((tc, i) => {
          if (prepared.writeToolToOpId.has(tc.name)) return; // read tools only here
          const toolCallId = `t${i}`;
          writer.write({
            type: "tool-input-available",
            toolCallId,
            toolName: tc.name,
            input: (tc.input ?? {}) as unknown,
          });
          writer.write({ type: "tool-output-available", toolCallId, output: { ok: true } });
        });

        writer.write({ type: "text-start", id: TEXT_ID });
        writer.write({ type: "text-delta", id: TEXT_ID, delta: text });
        writer.write({ type: "text-end", id: TEXT_ID });

        // Sources panel: the web pages / KB / files this turn grounded on, emitted
        // as a synthetic `cited_sources` tool part AFTER the answer so it renders
        // as a tidy "Sources" row at the end.
        const sources = collectSources(rawToolCalls, rawToolResults);
        if (sources.length) {
          writer.write({ type: "tool-input-available", toolCallId: "sources", toolName: "cited_sources", input: {} });
          writer.write({ type: "tool-output-available", toolCallId: "sources", output: { sources } });
        }

        rawToolCalls.forEach((tc, i) => {
          const operationId = prepared.writeToolToOpId.get(tc.name);
          if (!operationId) return; // propose_* tools only → cards below the answer
          const toolCallId = `t${i}`;
          const op = findOperation(operationId);
          const args = (tc.input ?? {}) as Record<string, unknown>;
          writer.write({
            type: "tool-input-available",
            toolCallId,
            toolName: tc.name,
            input: args as unknown,
          });
          writer.write({
            type: "tool-output-available",
            toolCallId,
            output: {
              ok: true,
              proposal: {
                id: operationId,
                operationId,
                args,
                label: op?.label ? op.label(args) : operationId,
              },
            },
          });
        });
        const proposals = buildAssistantProposals(rawToolCalls, prepared.writeToolToOpId);
        writer.write({
          type: "message-metadata",
          messageMetadata: { proposals, toolCalls: rawToolCalls } satisfies SableMetadata,
        });
        await persistAssistant(prepared.conv.id, text, rawToolCalls, prepared.writeToolToOpId);
      },
      onError: (e) => (e instanceof Error ? e.message : "The AI request failed."),
    });
    return createUIMessageStreamResponse({ stream });
  }

  /* ── ai-sdk providers: real token streaming ── */
  const rawToolCalls: { name: string; input: unknown }[] = [];

  // Local Ollama is frequently text-only; drop image/PDF parts to the text
  // fallback so a vision payload doesn't fail the whole stream mid-flight.
  if (prepared.hasBinaryParts && provider === "ollama" && prepared.messages.length > 0) {
    prepared.messages[prepared.messages.length - 1] = {
      role: "user",
      content: prepared.built.text,
    };
  }

  const result = streamText({
    model: await resolveChatModel(),
    system: prepared.system,
    messages: prepared.messages,
    tools: prepared.tools,
    stopWhen: stepCountIs(10),
    maxOutputTokens: await chatMaxOutputTokens(),
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls) {
        rawToolCalls.push({ name: tc.toolName, input: (tc as { input?: unknown }).input });
      }
    },
  });

  // Whether a proposal took the turn's staged attachments (set on `finish`, read
  // in onFinish for cleanup). rawToolCalls are complete by the finish part.
  let usedStaged = false;

  return result.toUIMessageStreamResponse<UIMessage<SableMetadata>>({
    messageMetadata: ({ part }) => {
      if (part.type === "finish") {
        usedStaged = injectStagedAttachments(rawToolCalls, prepared.writeToolToOpId, stagedIds);
        return {
          proposals: buildAssistantProposals(rawToolCalls, prepared.writeToolToOpId),
          toolCalls: rawToolCalls,
        };
      }
      return undefined;
    },
    onFinish: async ({ responseMessage }) => {
      await persistAssistant(
        prepared.conv.id,
        textOf(responseMessage),
        rawToolCalls,
        prepared.writeToolToOpId,
      );
      if (stagedIds.length && !usedStaged) await deleteStagedAttachments(me.id, stagedIds);
    },
    onError: (e) => (e instanceof Error ? e.message : "The AI request failed."),
  });
}
