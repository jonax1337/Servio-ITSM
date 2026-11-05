import {
  query,
  tool as sdkTool,
  createSdkMcpServer,
  type CanUseTool,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpSSEServerConfig,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";
import type { ModelMessage, ToolSet } from "ai";
import type { ZodRawShape } from "zod";
import {
  AgentTranscript,
  agentRunFailure,
  createAgentEventMapper,
  MCP_SERVER,
  SKILL_TOOL,
  TOOL_PREFIX,
  type AgentChunk,
} from "@/lib/claude-agent-events";
import {
  ensurePortalWorkspace,
  ensureSableWorkspace,
  type SableAudience,
  type SableWorkspace,
} from "@/lib/sable-workspace";

/**
 * Sable's ONE agent harness: every AI call runs through the locally-installed
 * `claude` CLI via the Claude Agent SDK, whatever model is configured, so all
 * models share the same agent loop, tools and transcript format. Which endpoint
 * the CLI talks to (Claude login, Anthropic API key, or the built-in
 * OpenAI-compatible translation proxy) is decided by the caller's ClaudeBackend.
 *
 * Our EXISTING ai-sdk tools are adapted 1:1 into in-process SDK tools (an
 * in-process MCP server), so there is zero tool-logic duplication. The tool
 * handlers run in THIS Node process, so they keep direct `db` access and the
 * acting agent's captured context (no HTTP, no token round-trip).
 */

/** Extract a zod raw shape ({field: zodType}) from an ai-sdk tool's inputSchema. */
function rawShape(inputSchema: unknown): Record<string, unknown> {
  const s = inputSchema as { shape?: Record<string, unknown> } | undefined;
  return s?.shape && typeof s.shape === "object" ? s.shape : {};
}

/**
 * Adapt an ai-sdk ToolSet into in-process SDK MCP tools. Each SDK tool simply
 * calls the original ai-sdk `execute` and serialises the result as text — so the
 * model sees identical behaviour to the built-in provider.
 */
function adaptTools(aiSdkTools: ToolSet) {
  return Object.entries(aiSdkTools).map(([name, t]) => {
    const def = t as {
      description?: string;
      inputSchema?: unknown;
      execute?: (args: unknown, opts: unknown) => Promise<unknown> | unknown;
    };
    return sdkTool(
      name,
      def.description ?? name,
      // The raw shape is a plain object of zod fields (SDK-compatible).
      rawShape(def.inputSchema) as ZodRawShape,
      async (args: unknown) => {
        let out: unknown;
        try {
          out = await def.execute?.(args, { toolCallId: name, messages: [] });
        } catch (e) {
          out = { error: e instanceof Error ? e.message : "tool failed" };
        }
        const text = typeof out === "string" ? out : JSON.stringify(out ?? {});
        return { content: [{ type: "text" as const, text }] };
      },
    );
  });
}

/** Flatten one message's content (string or multimodal parts) to plain text. */
function partText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        const part = p as { type?: string; text?: string };
        if (part.type === "text") return part.text ?? "";
        // The real image/document is sent as a content block alongside the
        // transcript (see buildStructuredPrompt); the text just references it.
        if (part.type === "image") return "(image attached)";
        if (part.type === "file") return "(file attached)";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Render the bounded history as a labelled transcript ending in an open Assistant turn. */
function buildTranscript(messages: ModelMessage[]): string {
  const lines = messages.map(
    (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${partText(m.content)}`,
  );
  lines.push("Assistant:");
  return lines.join("\n\n");
}

/** Parse a data URL into an Anthropic base64 source ({ media_type, data }). */
function dataUrlToSource(dataUrl: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  return m ? { media_type: m[1], data: m[2] } : null;
}

type BinaryBlock =
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

/** Extract Anthropic image/document blocks from ai-sdk image/file parts. */
function binaryBlocks(messages: ModelMessage[]): BinaryBlock[] {
  const blocks: BinaryBlock[] = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type?: string; image?: unknown; data?: unknown; mediaType?: string }>) {
      if (p.type === "image" && typeof p.image === "string") {
        const src = dataUrlToSource(p.image);
        if (src) blocks.push({ type: "image", source: { type: "base64", ...src } });
      } else if (p.type === "file" && typeof p.data === "string" && p.mediaType === "application/pdf") {
        const src = dataUrlToSource(p.data);
        if (src) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: src.data } });
      }
    }
  }
  return blocks;
}

/** Which model endpoint the local Claude Code process talks to, and how. */
export type ClaudeBackend = {
  model: string;
  /** Full subprocess environment (it REPLACES process.env for the CLI). */
  env: Record<string, string | undefined>;
  /** Extended thinking is a Claude feature; proxied models stream their own reasoning. */
  supportsThinking: boolean;
  /** False for typically text-only models (local Ollama): attachments stay text placeholders. */
  supportsImages: boolean;
};

/**
 * Remote MCP servers offered to one run, with the permission policy over their
 * tools: `allowedTools` run without asking, `disallowedTools` are hidden from
 * the model, and every other call goes through `canUseTool`.
 */
export type RemoteMcp = {
  servers: Record<string, McpHttpServerConfig | McpSSEServerConfig>;
  allowedTools: string[];
  disallowedTools: string[];
  canUseTool: CanUseTool;
  /** Substitute output for a call `canUseTool` intercepted; undefined otherwise. */
  interceptedResult(toolCallId: string): unknown;
};

export type AgentRunInput = {
  backend: ClaudeBackend;
  system?: string;
  messages: ModelMessage[];
  aiSdkTools: ToolSet;
  /** Remote MCP servers for this run (console chat only; never the portal). */
  remoteMcp?: RemoteMcp;
  /** Portal runs get no charter and no skills (default: console). */
  audience?: SableAudience;
  maxTurns?: number;
  /** Show the model's thinking (chat). One-shot helpers keep it off for speed. */
  thinking?: boolean;
  abortSignal?: AbortSignal;
};

const DEFAULT_MAX_TURNS = 12;

/**
 * Run one agent turn through the local Claude Code CLI and yield its steps LIVE
 * as UI chunks: thinking, tool calls (input streamed while the model writes it),
 * tool results and text. Our ai-sdk tools run in-process via the MCP adapter.
 * Throws when the run ends in an error (after yielding what was produced).
 */
export async function* streamClaudeAgent(input: AgentRunInput): AsyncGenerator<AgentChunk> {
  const server = createSdkMcpServer({
    name: MCP_SERVER,
    version: "1.0.0",
    tools: adaptTools(input.aiSdkTools),
  });
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (input.abortSignal?.aborted) abortController.abort();
  input.abortSignal?.addEventListener("abort", onAbort, { once: true });

  const workspace = input.audience === "portal" ? await ensurePortalWorkspace() : await ensureSableWorkspace();
  const remoteServers = input.remoteMcp?.servers;
  let markRemoteConnected = () => {};
  const remoteConnected = remoteServers ? new Promise<void>((resolve) => (markRemoteConnected = resolve)) : undefined;
  const iterator = query({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prompt: buildPrompt(input.messages, input.backend.supportsImages, remoteConnected) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: agentOptions(input, { server, abortController, workspace }) as any,
  });
  if (remoteServers) {
    void connectRemoteServers(iterator, { ...remoteServers, [MCP_SERVER]: server }).then(markRemoteConnected);
  }

  const mapper = createAgentEventMapper({ interceptedResult: input.remoteMcp?.interceptedResult });
  try {
    for await (const message of iterator as AsyncIterable<unknown>) {
      const failure = agentRunFailure(message);
      if (failure) throw new Error(failure);
      yield* mapper.map(message);
    }
  } finally {
    input.abortSignal?.removeEventListener("abort", onAbort);
  }
}

/** Run a turn to completion and return its accumulated transcript. */
export async function runClaudeAgent(input: AgentRunInput): Promise<AgentTranscript> {
  const transcript = new AgentTranscript();
  for await (const chunk of streamClaudeAgent(input)) transcript.record(chunk);
  return transcript;
}

/**
 * Remote servers are registered over the SDK control channel (stdin) rather
 * than `options.mcpServers`, which the SDK turns into a `--mcp-config` argument
 * — header secrets on the CLI command line would be readable by every local
 * process that can list processes. The prompt is held back until this settles,
 * so the first model request already sees the remote tools. A server that
 * can't connect sits the turn out (logged), like a failed discovery.
 *
 * Claude Code still expands `${VAR}` in these headers from its own env, which
 * is why `$` is rejected (lib/sable-mcp-policy.ts) and the env is allowlisted.
 */
async function connectRemoteServers(session: Query, servers: Record<string, McpServerConfig>): Promise<void> {
  try {
    const result = await session.setMcpServers(servers);
    for (const [name, error] of Object.entries(result.errors)) {
      console.warn(`[sable-mcp] "${name}" left out of this turn: ${error}`);
    }
  } catch (e) {
    console.warn(`[sable-mcp] remote MCP servers left out of this turn: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Isolation: the run lives in Sable's own workspace (charter + ITSM skills, or
 * nothing at all for the portal) with its own Claude config dir, so nothing of
 * the host — repo, the operator's CLAUDE.md, memory, plugins, hooks, MCP
 * servers — reaches the model. Its only built-in tool is Skill (console only).
 * Remote MCP servers join only when the caller passes them, under their own policy.
 */
function agentOptions(
  input: AgentRunInput,
  run: {
    server: ReturnType<typeof createSdkMcpServer>;
    abortController: AbortController;
    workspace: SableWorkspace;
  },
): Record<string, unknown> {
  const showThinking = Boolean(input.thinking) && input.backend.supportsThinking;
  const remote = input.remoteMcp;
  // No file, shell or web built-ins: the model never touches the host.
  const builtinTools = input.audience === "portal" ? [] : [SKILL_TOOL];
  return {
    model: input.backend.model,
    env: { ...input.backend.env, CLAUDE_CONFIG_DIR: run.workspace.configDir },
    cwd: run.workspace.cwd,
    systemPrompt: input.system, // a plain string REPLACES Claude Code's default
    mcpServers: { [MCP_SERVER]: run.server }, // remote servers: connectRemoteServers
    tools: builtinTools,
    skills: run.workspace.skills, // hides Claude Code's bundled skills
    allowedTools: [
      ...builtinTools,
      ...Object.keys(input.aiSdkTools).map((n) => TOOL_PREFIX + n),
      ...(remote?.allowedTools ?? []),
    ],
    ...(remote ? { disallowedTools: remote.disallowedTools, canUseTool: remote.canUseTool } : {}),
    settingSources: ["user"], // = Sable's own config dir (charter + skills), nothing else
    settings: { autoMemoryEnabled: false },
    strictMcpConfig: true, // only the servers passed here — never .mcp.json / plugins
    persistSession: false, // ticket data must not land in session transcripts
    includePartialMessages: true,
    maxTurns: input.maxTurns ?? DEFAULT_MAX_TURNS,
    thinking: showThinking ? { type: "adaptive", display: "summarized" } : { type: "disabled" },
    abortController: run.abortController,
  };
}

/**
 * When the turn carries images/PDFs and the model can see them, send a
 * structured user message with real Anthropic content blocks instead of
 * flattening to text; otherwise keep the simple string transcript (which
 * mentions the attachment). With `sendAfter`, the message is streamed once it
 * settles (a string prompt can't wait).
 */
function buildPrompt(messages: ModelMessage[], supportsImages: boolean, sendAfter?: Promise<void>): unknown {
  const blocks = supportsImages ? binaryBlocks(messages) : [];
  const transcript = buildTranscript(messages);
  if (!blocks.length && !sendAfter) return transcript;
  const content = blocks.length ? [{ type: "text", text: transcript }, ...blocks] : transcript;
  return (async function* () {
    await sendAfter;
    yield {
      type: "user" as const,
      message: { role: "user" as const, content },
      parent_tool_use_id: null,
    };
  })();
}
