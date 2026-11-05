import { randomBytes } from "node:crypto";

/**
 * Pure Anthropic Messages <-> OpenAI Chat Completions translation used by the
 * local LLM proxy (see ./server.ts). No I/O: every function maps data to data.
 */

// ---- Anthropic shapes (only the fields we read) ----------------------------

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicImageBlock = {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string };
};
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input?: unknown;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
};
type AnthropicIgnoredBlock = {
  type: "thinking" | "redacted_thinking" | "document";
};
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicIgnoredBlock;

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
  type?: string;
  name: string;
  description?: string;
  input_schema?: unknown;
};

type AnthropicToolChoice =
  | { type: "auto" | "any" | "none" }
  | { type: "tool"; name: string };

export type AnthropicRequest = {
  system?: string | { type: "text"; text: string }[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
};

// ---- OpenAI shapes ---------------------------------------------------------

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
};

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAIContentPart[] }
  | OpenAIAssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export type MaxTokensField = "max_tokens" | "max_completion_tokens";

export type OpenAIChatRequest = {
  model: string;
  messages: OpenAIMessage[];
  tools?: {
    type: "function";
    function: { name: string; description?: string; parameters: unknown };
  }[];
  tool_choice?:
    | "auto"
    | "required"
    | "none"
    | { type: "function"; function: { name: string } };
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: true;
  stream_options?: { include_usage: true };
} & Partial<Record<MaxTokensField, number>>;

type OpenAIUsage = { prompt_tokens?: number; completion_tokens?: number };

type OpenAIToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIAssistantFields = {
  content?: string | null;
  reasoning_content?: unknown;
  reasoning?: unknown;
  tool_calls?: OpenAIToolCallDelta[];
};

export type OpenAIChatResponse = {
  choices?: {
    message?: OpenAIAssistantFields;
    finish_reason?: string | null;
  }[];
  usage?: OpenAIUsage;
};

export type OpenAIChatChunk = {
  choices?: {
    delta?: OpenAIAssistantFields;
    finish_reason?: string | null;
  }[];
  usage?: OpenAIUsage | null;
};

// ---- Helpers ---------------------------------------------------------------

const DOCUMENT_PLACEHOLDER = "(document attached — not supported by this model)";
const TOOL_RESULT_IMAGE_PLACEHOLDER =
  "(image omitted — not supported in tool results)";
const OPENAI_HOST = "api.openai.com";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** api.openai.com rejects `max_tokens` for newer models; everyone else expects it. */
export function maxTokensFieldFor(baseURL: string): MaxTokensField {
  try {
    return new URL(baseURL).hostname === OPENAI_HOST
      ? "max_completion_tokens"
      : "max_tokens";
  } catch {
    return "max_tokens";
  }
}

// ---- Request: Anthropic -> OpenAI ------------------------------------------

export type RequestOptions = { model: string; maxTokensField: MaxTokensField };

export function toOpenAIRequest(
  req: AnthropicRequest,
  { model, maxTokensField }: RequestOptions,
): OpenAIChatRequest {
  const out: OpenAIChatRequest = { model, messages: convertMessages(req) };
  const tools = convertTools(req.tools);
  if (tools.length > 0) out.tools = tools;
  const toolChoice = convertToolChoice(req.tool_choice);
  if (toolChoice && tools.length > 0) out.tool_choice = toolChoice;
  if (req.max_tokens !== undefined) out[maxTokensField] = req.max_tokens;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop_sequences?.length) out.stop = req.stop_sequences;
  if (req.stream) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }
  return out;
}

function convertMessages(req: AnthropicRequest): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  const system = systemText(req.system);
  if (system) messages.push({ role: "system", content: system });
  for (const message of req.messages) {
    messages.push(
      ...(message.role === "assistant"
        ? convertAssistantMessage(message.content)
        : convertUserMessage(message.content)),
    );
  }
  return messages;
}

function systemText(system: AnthropicRequest["system"]): string {
  if (typeof system === "string") return system;
  return (system ?? []).map((block) => block.text).join("\n\n");
}

function convertUserMessage(
  content: string | AnthropicContentBlock[],
): OpenAIMessage[] {
  if (typeof content === "string") return [{ role: "user", content }];
  const toolMessages: OpenAIMessage[] = [];
  const parts: OpenAIContentPart[] = [];
  for (const block of content) {
    if (block.type === "tool_result") {
      toolMessages.push(convertToolResult(block));
      continue;
    }
    const part = convertUserPart(block);
    if (part) parts.push(part);
  }
  // Tool results must directly follow the assistant's tool calls.
  if (parts.length === 0) return toolMessages;
  return [...toolMessages, { role: "user", content: collapseTextParts(parts) }];
}

function convertUserPart(
  block: AnthropicContentBlock,
): OpenAIContentPart | undefined {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image_url", image_url: { url: imageUrl(block) } };
    case "document":
      return { type: "text", text: DOCUMENT_PLACEHOLDER };
    default:
      return undefined;
  }
}

function imageUrl({ source }: AnthropicImageBlock): string {
  return source.type === "base64"
    ? `data:${source.media_type};base64,${source.data}`
    : source.url;
}

function collapseTextParts(parts: OpenAIContentPart[]): string | OpenAIContentPart[] {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type !== "text") return parts;
    texts.push(part.text);
  }
  return texts.join("\n");
}

function convertToolResult(block: AnthropicToolResultBlock): OpenAIMessage {
  const text = toolResultText(block.content);
  return {
    role: "tool",
    tool_call_id: block.tool_use_id,
    content: block.is_error ? `Error: ${text}` : text,
  };
}

function toolResultText(content: AnthropicToolResultBlock["content"]): string {
  if (typeof content === "string") return content;
  const lines: string[] = [];
  for (const block of content ?? []) {
    if (block.type === "text") lines.push(block.text);
    else if (block.type === "image") lines.push(TOOL_RESULT_IMAGE_PLACEHOLDER);
  }
  return lines.join("\n");
}

function convertAssistantMessage(
  content: string | AnthropicContentBlock[],
): OpenAIMessage[] {
  if (typeof content === "string") {
    return content ? [{ role: "assistant", content }] : [];
  }
  const texts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];
  for (const block of content) {
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "tool_use") toolCalls.push(convertToolUse(block));
  }
  if (texts.length === 0 && toolCalls.length === 0) return [];
  const message: OpenAIAssistantMessage = {
    role: "assistant",
    content: texts.length > 0 ? texts.join("\n") : null,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return [message];
}

function convertToolUse(block: AnthropicToolUseBlock): OpenAIToolCall {
  return {
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
  };
}

function convertTools(tools: AnthropicTool[] | undefined) {
  const functionTools = (tools ?? []).filter(
    (tool) => tool.type === undefined || tool.type === "custom",
  );
  return functionTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

function convertToolChoice(
  choice: AnthropicToolChoice | undefined,
): OpenAIChatRequest["tool_choice"] {
  switch (choice?.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return { type: "function", function: { name: choice.name } };
    default:
      return undefined;
  }
}

/** Rough input-token estimate (chars / 4) for the count_tokens endpoint. */
export function estimateInputTokens(req: AnthropicRequest): number {
  const serialized = JSON.stringify({
    system: req.system,
    messages: req.messages,
    tools: req.tools,
  });
  return Math.ceil(serialized.length / 4);
}

// ---- Response: OpenAI -> Anthropic (non-streaming) -------------------------

export type AnthropicStopReason = "end_turn" | "max_tokens" | "tool_use";

type ResponseBlock =
  | { type: "thinking"; thinking: string; signature: "" }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type AnthropicMessageResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ResponseBlock[];
  stop_reason: AnthropicStopReason;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
};

export function toAnthropicMessage(
  response: OpenAIChatResponse,
  model: string,
): AnthropicMessageResponse {
  const choice = response.choices?.[0];
  const message = choice?.message ?? {};
  const content = responseBlocks(message);
  const hasToolUse = content.some((block) => block.type === "tool_use");
  return {
    id: newId("msg"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason, hasToolUse),
    stop_sequence: null,
    usage: usageOf(response.usage),
  };
}

function responseBlocks(message: OpenAIAssistantFields): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  const thinking =
    nonEmptyString(message.reasoning_content) ?? nonEmptyString(message.reasoning);
  if (thinking) blocks.push({ type: "thinking", thinking, signature: "" });
  const text = nonEmptyString(message.content);
  if (text) blocks.push({ type: "text", text });
  for (const call of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: call.id ?? newId("toolu"),
      name: call.function?.name ?? "",
      input: parseToolInput(call.function?.arguments),
    });
  }
  return blocks;
}

function parseToolInput(args: string | undefined): object {
  try {
    const parsed: unknown = JSON.parse(args ?? "");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function usageOf(usage: OpenAIUsage | null | undefined) {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  };
}

/**
 * Some OpenAI-compatible servers report "stop" even when tool calls were made;
 * the tool calls win, since that is what the Claude Code loop acts on.
 */
function mapStopReason(
  reason: string | null | undefined,
  hasToolUse: boolean,
): AnthropicStopReason {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  return hasToolUse ? "tool_use" : "end_turn";
}

// ---- Response: OpenAI -> Anthropic (streaming) -----------------------------

export type StreamTranslator = {
  /** Translate one upstream chunk into zero or more fully formatted SSE events. */
  push(chunk: OpenAIChatChunk): string[];
  /** Close open blocks and end the message; safe to call without any chunk. */
  finish(): string[];
};

type OpenBlock = { key: string; index: number; isThinking: boolean };

type ToolCallState = {
  key: string;
  id?: string;
  name?: string;
  started: boolean;
  /** Argument fragments that arrived before the tool name. */
  pendingArgs: string;
};

class StreamTranslatorImpl implements StreamTranslator {
  private readonly messageId = newId("msg");
  private pending: string[] = [];
  private started = false;
  private finished = false;
  private nextBlockIndex = 0;
  private open: OpenBlock | null = null;
  private toolCalls = new Map<number, ToolCallState>();
  private toolCallCount = 0;
  private finishReason: string | null | undefined;
  private usage = { input_tokens: 0, output_tokens: 0 };

  constructor(private readonly model: string) {}

  push(chunk: OpenAIChatChunk): string[] {
    if (this.finished) return [];
    this.ensureStarted();
    if (chunk.usage) this.usage = usageOf(chunk.usage);
    const choice = chunk.choices?.[0];
    if (choice) {
      this.applyDelta(choice.delta ?? {});
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }
    return this.drain();
  }

  finish(): string[] {
    if (this.finished) return [];
    this.ensureStarted();
    this.closeBlock();
    this.emit("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: mapStopReason(this.finishReason, this.toolCallCount > 0),
        stop_sequence: null,
      },
      usage: this.usage,
    });
    this.emit("message_stop", { type: "message_stop" });
    this.finished = true;
    return this.drain();
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.emit("message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private applyDelta(delta: OpenAIAssistantFields): void {
    const thinking =
      nonEmptyString(delta.reasoning_content) ?? nonEmptyString(delta.reasoning);
    if (thinking) this.appendThinking(thinking);
    const text = nonEmptyString(delta.content);
    if (text) this.appendText(text);
    for (const call of delta.tool_calls ?? []) this.appendToolCall(call);
  }

  private appendThinking(thinking: string): void {
    this.ensureBlock("thinking", true, {
      type: "thinking",
      thinking: "",
      signature: "",
    });
    this.emitDelta({ type: "thinking_delta", thinking });
  }

  private appendText(text: string): void {
    this.ensureBlock("text", false, { type: "text", text: "" });
    this.emitDelta({ type: "text_delta", text });
  }

  private appendToolCall(call: OpenAIToolCallDelta): void {
    const state = this.toolCallState(call);
    state.id ??= call.id;
    state.name ??= call.function?.name;
    const args = call.function?.arguments ?? "";
    if (state.started) {
      if (this.open?.key === state.key) this.emitArguments(args);
      return;
    }
    if (!state.name) {
      state.pendingArgs += args;
      return;
    }
    state.started = true;
    this.ensureBlock(state.key, false, {
      type: "tool_use",
      id: state.id ?? newId("toolu"),
      name: state.name,
      input: {},
    });
    this.emitArguments(state.pendingArgs + args);
    state.pendingArgs = "";
  }

  /**
   * Calls are keyed by OpenAI's `index`; a different id on a known index means
   * the server reuses indices, so it is a new call.
   */
  private toolCallState(call: OpenAIToolCallDelta): ToolCallState {
    const index = call.index ?? 0;
    const existing = this.toolCalls.get(index);
    if (existing && !(call.id && existing.id && call.id !== existing.id)) {
      return existing;
    }
    const state: ToolCallState = {
      key: `tool:${this.toolCallCount++}`,
      started: false,
      pendingArgs: "",
    };
    this.toolCalls.set(index, state);
    return state;
  }

  private emitArguments(partialJson: string): void {
    if (partialJson) {
      this.emitDelta({ type: "input_json_delta", partial_json: partialJson });
    }
  }

  private ensureBlock(key: string, isThinking: boolean, block: object): void {
    if (this.open?.key === key) return;
    this.closeBlock();
    const index = this.nextBlockIndex++;
    this.open = { key, index, isThinking };
    this.emit("content_block_start", {
      type: "content_block_start",
      index,
      content_block: block,
    });
  }

  private closeBlock(): void {
    if (!this.open) return;
    const { index, isThinking } = this.open;
    if (isThinking) this.emitDelta({ type: "signature_delta", signature: "" });
    this.emit("content_block_stop", { type: "content_block_stop", index });
    this.open = null;
  }

  private emitDelta(delta: object): void {
    if (!this.open) return;
    this.emit("content_block_delta", {
      type: "content_block_delta",
      index: this.open.index,
      delta,
    });
  }

  private emit(type: string, data: object): void {
    this.pending.push(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private drain(): string[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
}

export function createStreamTranslator(model: string): StreamTranslator {
  return new StreamTranslatorImpl(model);
}
