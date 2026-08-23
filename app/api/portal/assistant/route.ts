import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { getSessionUser, getCurrentUser } from "@/lib/session";
import { aiConfigured, currentProvider, resolveChatModel, chatMaxOutputTokens, generateAiChat } from "@/lib/ai";
import { checkAiRate } from "@/lib/rate-limit";
import {
  buildPortalTools,
  buildUserParts,
  portalProposalForTool,
  SYSTEM_PROMPT,
  type ChatAttachment,
} from "@/lib/portal-assistant";

/**
 * Streaming self-service (portal) assistant — the same assistant-ui Thread as
 * the console, USER-scoped and EPHEMERAL (no persistence: the client runtime
 * holds the transcript). propose_* tools return the draft as their result so
 * the portal tool UI can render a confirm card; the claude-code provider is
 * buffered and synthesises the tool parts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TEXT_ID = "t0";
const MAX_TURNS = 12;

/** Concatenate the text parts of a UI message. */
function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Attachments (data-URL parts) on the latest user message. assistant-ui's
 * SimpleImageAttachmentAdapter inlines screenshots; depending on the wire shape
 * they arrive as `file` parts (url + mediaType) or `image` parts (image field),
 * so accept both — used for vision AND to link the files to a created ticket.
 */
function attachmentsOf(m: UIMessage | undefined): ChatAttachment[] {
  return (m?.parts ?? [])
    .map((p) => {
      const fp = p as { type: string; mediaType?: string; filename?: string; url?: string; image?: string };
      const dataUrl = String(fp.url ?? fp.image ?? "");
      if (!dataUrl.startsWith("data:")) return null;
      const type = fp.mediaType ?? (fp.type === "image" ? "image/png" : "");
      return { name: fp.filename ?? "file", type, size: 0, dataUrl };
    })
    .filter((a): a is ChatAttachment => a !== null);
}

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return new Response("Not authorised", { status: 401 });
  // Re-check the DB: the JWT may predate a deactivation, and the portal serves
  // the whole user population — every request here drives an AI generation.
  const row = await getCurrentUser();
  if (!row || !row.isActive) return new Response("Not authorised", { status: 401 });

  const limited = checkAiRate(me.id);
  if (limited) {
    return new Response("Too many requests — please wait a moment.", {
      status: 429,
      headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
    });
  }

  if (!(await aiConfigured())) return new Response("AI is not configured.", { status: 400 });

  let body: { messages?: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const recent = msgs.filter((m) => m.role === "user" || m.role === "assistant").slice(-MAX_TURNS);
  const lastUser = [...recent].reverse().find((m) => m.role === "user");
  const attachments = attachmentsOf(lastUser);

  // History from the client transcript (ephemeral — no DB).
  const messages: ModelMessage[] = recent
    .map((m) => ({ role: m.role as "user" | "assistant", content: textOf(m).slice(0, 4000) }))
    .filter((m) => m.content.trim());
  if (!messages.length && !attachments.length) {
    return new Response("Nothing to send.", { status: 400 });
  }
  // Attach the current turn's files to the last user message (multimodal).
  const lastIdx = messages.length - 1;
  if (attachments.length && lastIdx >= 0 && messages[lastIdx].role === "user") {
    const text = typeof messages[lastIdx].content === "string" ? (messages[lastIdx].content as string) : "";
    messages[lastIdx] = { role: "user", content: buildUserParts(text, attachments) } as ModelMessage;
  }

  // Slim files that ride along on the propose_* tool result (ai-sdk path) so the
  // confirm card can link them to the ticket; the claude-code branch below injects
  // the same shape itself.
  const slimAttachments = attachments.map((a) => ({ name: a.name, type: a.type, dataUrl: a.dataUrl }));
  const tools = buildPortalTools(me.id, slimAttachments);
  const provider = await currentProvider();

  /* ── claude-code: buffered, tool parts synthesised (read tools → answer → drafts) ── */
  if (provider === "claude-code") {
    const stream = createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        let text = "(no answer)";
        let rawToolCalls: { name: string; input: unknown }[] = [];
        try {
          const result = await generateAiChat({ system: SYSTEM_PROMPT, messages, tools, maxSteps: 6 });
          text = result.text || "(no answer)";
          rawToolCalls = result.toolCalls ?? [];
        } catch (e) {
          text = e instanceof Error ? `⚠️ ${e.message}` : "⚠️ The assistant ran into a problem.";
        }

        rawToolCalls.forEach((tc, i) => {
          if (tc.name.startsWith("propose_")) return; // read tools above the answer
          const toolCallId = `t${i}`;
          writer.write({ type: "tool-input-available", toolCallId, toolName: tc.name, input: (tc.input ?? {}) as unknown });
          writer.write({ type: "tool-output-available", toolCallId, output: { ok: true } });
        });

        writer.write({ type: "text-start", id: TEXT_ID });
        writer.write({ type: "text-delta", id: TEXT_ID, delta: text });
        writer.write({ type: "text-end", id: TEXT_ID });

        for (let i = 0; i < rawToolCalls.length; i++) {
          const tc = rawToolCalls[i];
          if (!tc.name.startsWith("propose_")) continue; // drafts below the answer
          const proposal = await portalProposalForTool(me.id, tc.name, tc.input);
          const toolCallId = `t${i}`;
          // Carry the turn's attachments on the draft so the confirm card can link
          // them to the ticket it creates (the runtime is ephemeral — no staging).
          // Honour the model's attachFiles opt-out for an unrelated attachment.
          const attachFiles = (tc.input as { attachFiles?: boolean } | undefined)?.attachFiles !== false;
          writer.write({ type: "tool-input-available", toolCallId, toolName: tc.name, input: (tc.input ?? {}) as unknown });
          writer.write({
            type: "tool-output-available",
            toolCallId,
            output: proposal
              ? { ok: true, proposal, attachments: attachFiles ? slimAttachments : [] }
              : { ok: false, error: "Could not prepare that draft." },
          });
        }
      },
      onError: (e) => (e instanceof Error ? e.message : "The assistant ran into a problem."),
    });
    return createUIMessageStreamResponse({ stream });
  }

  /* ── ai-sdk providers: real token streaming (tool results carry the drafts) ── */
  const result = streamText({
    model: await resolveChatModel(),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(6),
    maxOutputTokens: await chatMaxOutputTokens(),
  });

  return result.toUIMessageStreamResponse<UIMessage>({
    onError: (e) => (e instanceof Error ? e.message : "The assistant ran into a problem."),
  });
}
