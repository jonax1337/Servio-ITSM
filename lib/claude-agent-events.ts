import type { UIMessageChunk } from "ai";

/**
 * Pure translation of Claude Code (Agent SDK) messages into ai-sdk UI message
 * chunks, so Sable's chat can render the agent loop LIVE: thinking, each tool
 * call as it is being written, its result, and the text between steps.
 *
 * Kept free of the SDK import so it can be unit-tested with plain objects.
 */

/** The UI chunk kinds the Claude Code harness produces. */
export type AgentChunk = Extract<
  UIMessageChunk,
  {
    type:
      | "start-step"
      | "finish-step"
      | "reasoning-start"
      | "reasoning-delta"
      | "reasoning-end"
      | "text-start"
      | "text-delta"
      | "text-end"
      | "tool-input-start"
      | "tool-input-delta"
      | "tool-input-available"
      | "tool-output-available"
      | "tool-output-error";
  }
>;

/** Name prefix Claude Code gives the tools of our in-process MCP server. */
export const MCP_SERVER = "servio";
export const TOOL_PREFIX = `mcp__${MCP_SERVER}__`;
/** Claude Code's built-in that loads one of Sable's skills — shown as a step. */
export const SKILL_TOOL = "Skill";
const SKILL_TOOL_UI_NAME = "use_skill";

/** Every MCP tool Claude Code exposes is named `mcp__<server>__<tool>`. */
const MCP_TOOL_PREFIX = "mcp__";
const MCP_NAME_SEPARATOR = "__";
/** Characters Claude Code replaces with `_` when it builds an MCP tool name. */
const NON_MCP_NAME_CHARS = /[^a-zA-Z0-9_-]/g;

/**
 * Claude Code's name for a remote MCP server's tool. Server names are slugs
 * without `__` (enforced on save), so the name parses back unambiguously.
 */
export function remoteToolName(server: string, tool: string): string {
  return MCP_TOOL_PREFIX + server + MCP_NAME_SEPARATOR + tool.replace(NON_MCP_NAME_CHARS, "_");
}

/** `{ server, tool }` of a remote MCP tool name, or null for Servio's own tools and anything else. */
export function parseRemoteToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX) || name.startsWith(TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const split = rest.indexOf(MCP_NAME_SEPARATOR);
  if (split <= 0 || split + MCP_NAME_SEPARATOR.length >= rest.length) return null;
  return { server: rest.slice(0, split), tool: rest.slice(split + MCP_NAME_SEPARATOR.length) };
}

/**
 * The UI tool name for a Claude Code tool_use, or null when it is not ours to
 * show. Servio's own tools drop their prefix; remote MCP tools keep their full
 * name so the chat can say which server ran them.
 */
function uiToolName(name: string | undefined): string | null {
  if (!name) return null;
  if (name === SKILL_TOOL) return SKILL_TOOL_UI_NAME;
  if (name.startsWith(TOOL_PREFIX)) return name.slice(TOOL_PREFIX.length);
  if (parseRemoteToolName(name)) return name;
  return null;
}

/** Hooks a run can give the mapper. */
export type AgentEventMapperOptions = {
  /**
   * The output to show for a tool call the run's permission policy intercepted
   * (e.g. a remote MCP write turned into an approval proposal), or undefined to
   * show the call's real result.
   */
  interceptedResult?(toolCallId: string): unknown;
};

type OpenBlock =
  | { kind: "reasoning"; id: string }
  | { kind: "text"; id: string }
  | { kind: "tool"; toolCallId: string; toolName: string; json: string }
  | { kind: "ignored" };

type StreamEvent = {
  type: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
};

type SdkMessage = {
  type: string;
  parent_tool_use_id?: string | null;
  event?: StreamEvent;
  message?: { content?: unknown };
};

type ToolResultBlock = {
  type?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

/**
 * Stateful mapper: feed it every SDK message of one `query()` run in order and
 * it returns the UI chunks to emit. Requires `includePartialMessages: true`.
 */
export function createAgentEventMapper(
  options: AgentEventMapperOptions = {},
): { map(message: unknown): AgentChunk[] } {
  const open = new Map<number, OpenBlock>();
  // Results may only reference calls the UI was told about: an unknown
  // toolCallId (e.g. a hallucinated built-in tool) aborts the client stream.
  const announcedToolCalls = new Set<string>();
  // Remote MCP output is foreign: shown as text, never parsed into an object,
  // so it can't pose as a harness-made result (e.g. an approval proposal).
  const remoteToolCalls = new Set<string>();
  let step = 0;

  function onStreamEvent(event: StreamEvent): AgentChunk[] {
    const index = event.index ?? 0;
    switch (event.type) {
      case "message_start":
        step += 1;
        open.clear();
        return [{ type: "start-step" }];
      case "message_stop":
        return [{ type: "finish-step" }];
      case "content_block_start":
        return startBlock(index, event.content_block ?? {});
      case "content_block_delta":
        return deltaBlock(open.get(index), event.delta ?? {});
      case "content_block_stop": {
        const block = open.get(index);
        open.delete(index);
        return stopBlock(block);
      }
      default:
        return [];
    }
  }

  function startBlock(index: number, block: NonNullable<StreamEvent["content_block"]>): AgentChunk[] {
    const id = `s${step}-b${index}`;
    if (block.type === "thinking") {
      open.set(index, { kind: "reasoning", id });
      return [{ type: "reasoning-start", id }];
    }
    if (block.type === "text") {
      open.set(index, { kind: "text", id });
      return [{ type: "text-start", id }];
    }
    const toolName = block.type === "tool_use" ? uiToolName(block.name) : null;
    if (block.id && toolName) {
      open.set(index, { kind: "tool", toolCallId: block.id, toolName, json: "" });
      announcedToolCalls.add(block.id);
      if (parseRemoteToolName(toolName)) remoteToolCalls.add(block.id);
      return [{ type: "tool-input-start", toolCallId: block.id, toolName }];
    }
    open.set(index, { kind: "ignored" });
    return [];
  }

  function deltaBlock(block: OpenBlock | undefined, delta: NonNullable<StreamEvent["delta"]>): AgentChunk[] {
    if (!block) return [];
    if (block.kind === "reasoning" && delta.type === "thinking_delta" && delta.thinking) {
      return [{ type: "reasoning-delta", id: block.id, delta: delta.thinking }];
    }
    if (block.kind === "text" && delta.type === "text_delta" && delta.text) {
      return [{ type: "text-delta", id: block.id, delta: delta.text }];
    }
    if (block.kind === "tool" && delta.type === "input_json_delta" && delta.partial_json) {
      block.json += delta.partial_json;
      return [{ type: "tool-input-delta", toolCallId: block.toolCallId, inputTextDelta: delta.partial_json }];
    }
    return [];
  }

  function stopBlock(block: OpenBlock | undefined): AgentChunk[] {
    if (!block) return [];
    if (block.kind === "reasoning") return [{ type: "reasoning-end", id: block.id }];
    if (block.kind === "text") return [{ type: "text-end", id: block.id }];
    if (block.kind === "tool") {
      return [
        {
          type: "tool-input-available",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          input: parseToolInput(block.json),
        },
      ];
    }
    return [];
  }

  return {
    map(message: unknown): AgentChunk[] {
      const msg = message as SdkMessage;
      // Subagent traffic (none expected: built-in tools are disabled) never
      // belongs in the top-level transcript.
      if (msg.parent_tool_use_id) return [];
      if (msg.type === "stream_event" && msg.event) return onStreamEvent(msg.event);
      if (msg.type === "user") return announcedResults(msg.message?.content);
      return [];
    },
  };

  function announcedResults(content: unknown): AgentChunk[] {
    const isRemote = (toolCallId: string) => remoteToolCalls.has(toolCallId);
    return toolResults(content, options.interceptedResult, isRemote).filter((chunk) => {
      if (!("toolCallId" in chunk) || !announcedToolCalls.has(chunk.toolCallId)) return false;
      announcedToolCalls.delete(chunk.toolCallId);
      remoteToolCalls.delete(chunk.toolCallId);
      return true;
    });
  }
}

type SdkResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
};

/**
 * The failure message of a run's final `result` message, or null when the
 * message is not a result or the run succeeded. `subtype: "success"` alone is
 * not enough: API failures (bad key, unknown model, upstream errors through the
 * proxy) end as a "success" result flagged `is_error`.
 */
export function agentRunFailure(message: unknown): string | null {
  const m = message as SdkResult;
  if (m.type !== "result" || (m.subtype === "success" && !m.is_error)) return null;
  return m.result?.trim() || m.errors?.join("; ") || `Claude Code ended with ${m.subtype ?? "an error"}`;
}

function parseToolInput(json: string): unknown {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json);
  } catch {
    return { _raw: json };
  }
}

/**
 * Tool results come back as `user` messages carrying `tool_result` blocks. An
 * intercepted call (denied by the permission policy) shows its substitute output
 * instead of the denial; that substitute is the only object a remote call's
 * output can ever be — its real output stays text.
 */
function toolResults(
  content: unknown,
  interceptedResult: AgentEventMapperOptions["interceptedResult"],
  isRemote: (toolCallId: string) => boolean,
): AgentChunk[] {
  if (!Array.isArray(content)) return [];
  return (content as ToolResultBlock[])
    .filter((b) => b.type === "tool_result" && typeof b.tool_use_id === "string")
    .map((b): AgentChunk => {
      const toolCallId = b.tool_use_id as string;
      const intercepted = interceptedResult?.(toolCallId);
      if (intercepted !== undefined) return { type: "tool-output-available", toolCallId, output: intercepted };
      const text = resultText(b.content);
      if (b.is_error) return { type: "tool-output-error", toolCallId, errorText: text || "Tool failed" };
      return { type: "tool-output-available", toolCallId, output: isRemote(toolCallId) ? text : parseToolOutput(text) };
    });
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const part = c as { type?: string; text?: string };
      return part.type === "text" ? (part.text ?? "") : "";
    })
    .join("");
}

/** Our tool handlers serialise their output as JSON text; restore the object. */
function parseToolOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Accumulates a run's chunks into what callers persist or return: the answer
 * text, the tool calls (with their final inputs), their outputs, and the
 * thinking. One instance per run.
 */
export class AgentTranscript {
  readonly toolCalls: { name: string; input: unknown }[] = [];
  readonly toolResults: { name: string; output: unknown }[] = [];
  private readonly textParts: string[] = [];
  private readonly reasoningParts: string[] = [];
  private readonly toolNames = new Map<string, string>();

  record(chunk: AgentChunk): void {
    switch (chunk.type) {
      case "text-start":
        this.textParts.push("");
        break;
      case "text-delta":
        this.textParts[this.textParts.length - 1] += chunk.delta;
        break;
      case "reasoning-start":
        this.reasoningParts.push("");
        break;
      case "reasoning-delta":
        this.reasoningParts[this.reasoningParts.length - 1] += chunk.delta;
        break;
      case "tool-input-available":
        this.toolNames.set(chunk.toolCallId, chunk.toolName);
        this.toolCalls.push({ name: chunk.toolName, input: chunk.input });
        break;
      case "tool-output-available": {
        const name = this.toolNames.get(chunk.toolCallId);
        if (name) this.toolResults.push({ name, output: chunk.output });
        break;
      }
    }
  }

  get text(): string {
    return joinNonEmpty(this.textParts);
  }

  get reasoning(): string | undefined {
    return joinNonEmpty(this.reasoningParts) || undefined;
  }
}

const ERROR_TEXT_ID = "agent-error";

/**
 * Forward a live agent run into a UI message stream while recording it. A
 * failure mid-run closes the blocks still streaming and is shown as a final
 * text part (recorded, so it is persisted like an answer) instead of silently
 * cutting the stream. A run the client aborted ends quietly.
 */
export async function pipeAgentRun(
  run: AsyncIterable<AgentChunk>,
  sink: {
    writer: { write(chunk: AgentChunk): void };
    transcript: AgentTranscript;
    fallbackError: string;
    abortSignal?: AbortSignal;
  },
): Promise<void> {
  const openBlocks = new Map<string, AgentChunk>();
  const emit = (chunk: AgentChunk) => {
    trackOpenBlock(openBlocks, chunk);
    sink.transcript.record(chunk);
    sink.writer.write(chunk);
  };
  try {
    for await (const chunk of run) emit(chunk);
  } catch (e) {
    [...openBlocks.values()].forEach(emit);
    if (sink.abortSignal?.aborted) return;
    const message = e instanceof Error ? e.message : sink.fallbackError;
    emit({ type: "text-start", id: ERROR_TEXT_ID });
    emit({ type: "text-delta", id: ERROR_TEXT_ID, delta: `⚠️ ${message}` });
    emit({ type: "text-end", id: ERROR_TEXT_ID });
  }
}

/** Remember, per open text/reasoning block, the chunk that would close it. */
function trackOpenBlock(openBlocks: Map<string, AgentChunk>, chunk: AgentChunk): void {
  if (chunk.type === "text-start") openBlocks.set(chunk.id, { type: "text-end", id: chunk.id });
  else if (chunk.type === "reasoning-start") openBlocks.set(chunk.id, { type: "reasoning-end", id: chunk.id });
  else if (chunk.type === "text-end" || chunk.type === "reasoning-end") openBlocks.delete(chunk.id);
}

function joinNonEmpty(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}
