import { generateText, generateObject, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";
import { getSetting, getBoolSetting, getNumberSetting } from "@/lib/settings";

/**
 * Self-hosted "AI Service Agent" (Sable) config. Config is resolved through
 * lib/settings (DB AppSetting overrides process.env), gated on an async
 * *Configured() boolean, and secrets never leak to the client. All AI runs
 * server-side (server actions / route handlers).
 *
 * `ollama` is a LOCAL, OpenAI-compatible endpoint — no key, data stays on-box.
 * `anthropic`/`openai` are EXTERNAL and require AI_ALLOW_EXTERNAL="true".
 */
export type AiProvider = "anthropic" | "openai" | "ollama" | "claude-code";

/**
 * Providers that authorise themselves and are NOT gated by AI_ALLOW_EXTERNAL:
 *  - ollama: local, data on-box.
 *  - claude-code: drives the operator's own logged-in `claude` CLI (their Pro/Max
 *    subscription). Selecting it IS the consent; data does leave the box (to
 *    Anthropic), which is called out in the settings UI.
 */
const SELF_AUTHORIZED: readonly AiProvider[] = ["ollama", "claude-code"];

async function provider(): Promise<AiProvider> {
  const p = ((await getSetting("AI_PROVIDER")) ?? "anthropic").toLowerCase();
  if (p === "openai") return "openai";
  if (p === "ollama") return "ollama";
  if (p === "claude-code" || p === "claude-cli") return "claude-code";
  return "anthropic";
}

function isSelfAuthorized(p: AiProvider): boolean {
  return SELF_AUTHORIZED.includes(p);
}

/** Privacy gate: true when external (non-local) providers are permitted. */
async function allowExternal(): Promise<boolean> {
  return getBoolSetting("AI_ALLOW_EXTERNAL");
}

/** Per-provider default model when AI_MODEL is unset. */
async function defaultModel(p: AiProvider): Promise<string> {
  if (p === "openai") return "gpt-4o";
  if (p === "ollama") return (await getSetting("OLLAMA_MODEL")) || "llama3.1";
  return "claude-sonnet-5"; // anthropic default (align with the settings-UI guidance)
}

async function modelId(p: AiProvider): Promise<string> {
  return (await getSetting("AI_MODEL")) || (await defaultModel(p));
}

/**
 * The gate (mirrors smtpConfigured() in lib/mail.ts). True only when the
 * configured provider can actually run:
 *  - local (ollama): always OK (no key needed)
 *  - external (anthropic/openai): requires AI_ALLOW_EXTERNAL="true" AND its key
 */
export async function aiConfigured(): Promise<boolean> {
  const p = await provider();
  // ollama (local) and claude-code (operator's own subscription CLI) self-authorise.
  if (isSelfAuthorized(p)) return true;
  if (!(await allowExternal())) return false; // privacy gate blocks external providers
  if (p === "anthropic") return Boolean(await getSetting("ANTHROPIC_API_KEY"));
  if (p === "openai") return Boolean(await getSetting("OPENAI_API_KEY"));
  return false;
}

/**
 * "Teaser" mode: when AI is NOT configured, still show the AI buttons as a
 * preview (a nudge to enable the feature). Clicking them surfaces a friendly
 * hint instead of running anything. Independent of aiConfigured().
 */
export async function aiTeaserEnabled(): Promise<boolean> {
  return getBoolSetting("AI_TEASER");
}

/**
 * Hard backstop: throws before any network call if a non-local provider is
 * selected while AI_ALLOW_EXTERNAL is false, so a misconfiguration can never
 * push ticket data off-box.
 */
async function assertPrivacy(p: AiProvider): Promise<void> {
  if (!isSelfAuthorized(p) && !(await allowExternal())) {
    throw new Error(
      `AI provider "${p}" is external and AI_ALLOW_EXTERNAL is not "true". Refusing to send data off-box.`,
    );
  }
}

/** Resolve the AI SDK model for the current AI_PROVIDER. Keys stay server-side. */
async function getModel() {
  const p = await provider();
  await assertPrivacy(p);
  if (p === "claude-code") {
    // claude-code has no ai-sdk model — it routes through the Agent SDK (CLI).
    // The generate* wrappers branch before here; this guards any other caller.
    throw new Error("The claude-code provider uses the CLI backend, not an ai-sdk model.");
  }
  const id = await modelId(p);

  if (p === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: (await getSetting("ANTHROPIC_API_KEY")) ?? undefined,
    });
    return anthropic(id);
  }

  if (p === "openai") {
    // OPENAI_BASE_URL lets you point at any OpenAI-compatible cloud (OpenAI,
    // Moonshot/Kimi, Zhipu/GLM, OpenRouter, …) — the model id comes from AI_MODEL.
    const openai = createOpenAI({
      apiKey: (await getSetting("OPENAI_API_KEY")) ?? undefined,
      baseURL: (await getSetting("OPENAI_BASE_URL")) || undefined,
    });
    return openai(id);
  }

  // ollama — local, OpenAI-compatible, no API key required.
  // supportsStructuredOutputs → the SDK sends response_format:json_schema (strict),
  // so Ollama grammar-constrains output to our zod schema (fixes generateObject:
  // without it the model free-forms JSON with wrong keys / missing fields).
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: (await getSetting("OLLAMA_BASE_URL")) || "http://localhost:11434/v1",
    supportsStructuredOutputs: true,
  });
  return ollama(id);
}

async function maxOutputTokens(): Promise<number> {
  const n = await getNumberSetting("AI_MAX_OUTPUT_TOKENS", 1024);
  return Number.isFinite(n) && n > 0 ? n : 1024;
}

/** Pull the first JSON object out of a text blob (tolerates code fences / prose). */
function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Thin wrapper over generateText. Returns trimmed text. */
export async function generateAiText(input: {
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<string> {
  if ((await provider()) === "claude-code") {
    const { generateViaClaudeSdk } = await import("@/lib/claude-cli");
    const { text } = await generateViaClaudeSdk({
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      aiSdkTools: {},
    });
    return text.trim();
  }
  const { text } = await generateText({
    model: await getModel(),
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens ?? (await maxOutputTokens()),
    temperature: input.temperature,
  });
  return text.trim();
}

/**
 * Multi-step chat with optional tools (the agent loop). The model may call tools
 * (e.g. web search) up to maxSteps times before producing its final answer.
 * Returns the final text plus the tool calls it made (for UI activity display).
 */
export async function generateAiChat(input: {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxSteps?: number;
  temperature?: number;
  /** Enable extended thinking (claude-code / reasoning-capable models); returns `reasoning`. */
  maxThinkingTokens?: number;
}): Promise<{
  text: string;
  toolCalls: { name: string; input: unknown }[];
  toolResults: { name: string; output: unknown }[];
  reasoning?: string;
}> {
  // claude-code routes through the Agent SDK (subscription CLI), adapting the
  // same ai-sdk tools into in-process SDK tools so tool use + proposals work
  // identically to the built-in providers.
  if ((await provider()) === "claude-code") {
    const { generateViaClaudeSdk } = await import("@/lib/claude-cli");
    return generateViaClaudeSdk({
      system: input.system,
      messages: input.messages,
      aiSdkTools: input.tools ?? {},
      maxThinkingTokens: input.maxThinkingTokens,
    });
  }
  const result = await generateText({
    model: await getModel(),
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 6),
    temperature: input.temperature,
    maxOutputTokens: Math.max(await maxOutputTokens(), 2048),
  });
  const toolCalls = result.steps.flatMap((s) =>
    s.toolCalls.map((tc) => ({ name: tc.toolName, input: (tc as { input?: unknown }).input })),
  );
  const toolResults = result.steps.flatMap((s) =>
    (s.toolResults ?? []).map((tr) => ({
      name: (tr as { toolName: string }).toolName,
      output: (tr as { output?: unknown; result?: unknown }).output ?? (tr as { result?: unknown }).result,
    })),
  );
  // reasoning-capable models (e.g. Anthropic extended thinking) expose reasoningText.
  const reasoning = (result as { reasoningText?: string }).reasoningText?.trim() || undefined;
  return { text: result.text.trim(), toolCalls, toolResults, reasoning };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Streaming primitives — used by the assistant route handler
 * (app/api/assistant/chat/route.ts) which calls `streamText` directly.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The effective AI provider (settings-resolved). */
export async function currentProvider(): Promise<AiProvider> {
  return provider();
}

/**
 * The privacy-checked ai-sdk model for streaming. Throws for `claude-code`
 * (no ai-sdk model — the caller must use the buffered `generateAiChat` path).
 */
export async function resolveChatModel() {
  return getModel();
}

/** The configured output-token cap (min 2048 for the multi-step chat loop). */
export async function chatMaxOutputTokens(): Promise<number> {
  return Math.max(await maxOutputTokens(), 2048);
}

/** Thin wrapper over generateObject. Returns the typed object. */
export async function generateAiObject<T>(input: {
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  if ((await provider()) === "claude-code") {
    // No schema-constrained decoding via the CLI — instruct strict JSON, then
    // parse + zod-validate (one retry). Callers already handle failures.
    const { generateViaClaudeSdk } = await import("@/lib/claude-cli");
    const system =
      (input.system ? input.system + "\n\n" : "") +
      "Respond with ONLY a single valid JSON object that satisfies the request. " +
      "No markdown, no code fences, no commentary — just the JSON.";
    let lastErr = "no output";
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text } = await generateViaClaudeSdk({
        system,
        messages: [{ role: "user", content: input.prompt }],
        aiSdkTools: {},
      });
      const parsed = input.schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error?.message ?? "invalid JSON";
    }
    throw new Error(`Claude did not return valid structured output: ${lastErr}`);
  }
  const { object } = await generateObject({
    model: await getModel(),
    system: input.system,
    prompt: input.prompt,
    schema: input.schema,
    maxOutputTokens: input.maxOutputTokens ?? (await maxOutputTokens()),
  });
  return object;
}
