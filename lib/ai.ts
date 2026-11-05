import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";
import { getSetting, getBoolSetting, getNumberSetting } from "@/lib/settings";
import {
  runClaudeAgent,
  streamClaudeAgent,
  type AgentRunInput,
  type ClaudeBackend,
  type RemoteMcp,
} from "@/lib/claude-cli";
import type { AgentChunk, AgentTranscript } from "@/lib/claude-agent-events";
import { leaseProxyRoute, type ProxyUpstream } from "@/lib/llm-proxy/server";
import { inheritedHostEnv } from "@/lib/claude-env";
import type { SableAudience } from "@/lib/sable-workspace";

/**
 * Self-hosted "AI Service Agent" (Sable) config. Config is resolved through
 * lib/settings (DB AppSetting overrides process.env), gated on an async
 * *Configured() boolean, and secrets never leak to the client. All AI runs
 * server-side (server actions / route handlers).
 *
 * EVERY provider runs through the same local Claude Code harness
 * (lib/claude-cli.ts) so all models share one agent loop and tool format; the
 * provider only decides which endpoint Claude Code talks to.
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
  if (p === "claude-code") return "sonnet"; // CLI alias → the subscription's current Sonnet
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
  // Sable's isolated Claude Code instance can't use the operator's interactive
  // login, so the subscription needs a long-lived token (`claude setup-token`).
  if (p === "claude-code") return Boolean(await getSetting("CLAUDE_CODE_OAUTH_TOKEN"));
  // ollama (local) self-authorises.
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

/**
 * Claude Code needs headroom: adaptive thinking shares the output budget with
 * the answer, so a small AI_MAX_OUTPUT_TOKENS would truncate agent turns.
 */
const MIN_AGENT_OUTPUT_TOKENS = 8192;

/**
 * The CLI inherits only an allowlist of the host env (lib/claude-env.ts):
 * provider credentials and endpoints are set explicitly per backend, the
 * upstream OpenAI key stays inside this process (the proxy holds it), and no
 * Servio secret is there for `${VAR}` expansion to leak.
 */
async function baseClaudeEnv(): Promise<Record<string, string | undefined>> {
  const env = inheritedHostEnv();
  // Blank / "auto" / 0 leaves the variable unset: Claude Code then uses the model's own default.
  const maxTokens = await getNumberSetting("AI_MAX_OUTPUT_TOKENS", 0);
  if (maxTokens > 0) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(Math.max(maxTokens, MIN_AGENT_OUTPUT_TOKENS));
  }
  // No telemetry/update traffic: with a local model nothing should leave the box.
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return env;
}

/** The OpenAI-compatible endpoint behind the translation proxy, per provider. */
async function proxyUpstream(p: "openai" | "ollama", model: string): Promise<ProxyUpstream> {
  if (p === "ollama") {
    return { baseURL: (await getSetting("OLLAMA_BASE_URL")) || "http://localhost:11434/v1", model };
  }
  // OPENAI_BASE_URL lets you point at any OpenAI-compatible cloud (OpenAI,
  // Moonshot/Kimi, Zhipu/GLM, OpenRouter, …) — the model id comes from AI_MODEL.
  return {
    baseURL: (await getSetting("OPENAI_BASE_URL")) || "https://api.openai.com/v1",
    apiKey: (await getSetting("OPENAI_API_KEY")) ?? undefined,
    model,
  };
}

/**
 * Point the local Claude Code CLI at the configured provider:
 *  - claude-code:   the CLI's own login (Pro/Max subscription)
 *  - anthropic:     ANTHROPIC_API_KEY
 *  - openai/ollama: the built-in Anthropic→OpenAI translation proxy (localhost)
 * Callers must release() when the run ends (frees the proxy route).
 */
async function openClaudeBackend(): Promise<{ backend: ClaudeBackend; release(): void }> {
  const p = await provider();
  await assertPrivacy(p);
  const model = await modelId(p);
  const env = await baseClaudeEnv();

  if (p === "openai" || p === "ollama") {
    const lease = await leaseProxyRoute(await proxyUpstream(p, model));
    env.ANTHROPIC_BASE_URL = lease.baseURL;
    env.ANTHROPIC_AUTH_TOKEN = lease.token;
    // A corporate HTTP(S)_PROXY must not intercept the loopback proxy call.
    env.NO_PROXY = [env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
    // Local Ollama models are frequently text-only: an image would fail the turn.
    const backend = { model, env, supportsThinking: false, supportsImages: p === "openai" };
    return { backend, release: lease.release };
  }
  if (p === "anthropic") {
    env.ANTHROPIC_API_KEY = (await getSetting("ANTHROPIC_API_KEY")) ?? undefined;
  } else {
    env.CLAUDE_CODE_OAUTH_TOKEN = await subscriptionToken();
  }
  return { backend: { model, env, supportsThinking: true, supportsImages: true }, release: () => {} };
}

async function subscriptionToken(): Promise<string> {
  const token = await getSetting("CLAUDE_CODE_OAUTH_TOKEN");
  if (!token) {
    throw new Error(
      "The Claude subscription needs a token for Sable's isolated instance: run `claude setup-token` and paste it under Settings › Sable.",
    );
  }
  return token;
}

type AgentRequest = Omit<AgentRunInput, "backend">;

/** Run one agent turn to completion on the configured backend. */
async function runAgent(request: AgentRequest): Promise<AgentTranscript> {
  const { backend, release } = await openClaudeBackend();
  try {
    return await runClaudeAgent({ ...request, backend });
  } finally {
    release();
  }
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

/** One-shot text generation (no tools, no thinking). Returns trimmed text. */
export async function generateAiText(input: { system?: string; prompt: string }): Promise<string> {
  const transcript = await runAgent({
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
    aiSdkTools: {},
    maxTurns: 1,
  });
  return transcript.text.trim();
}

/**
 * The agent loop as a LIVE stream of UI chunks (thinking, tool calls, tool
 * results, text) for the chat route handlers. The backend is released when the
 * stream ends or the consumer stops iterating.
 */
export async function* streamAiChat(input: {
  system?: string;
  messages: ModelMessage[];
  tools: ToolSet;
  remoteMcp?: RemoteMcp;
  /** "portal" = self-service end users: no console charter, no skills. */
  audience: SableAudience;
  maxSteps: number;
  abortSignal?: AbortSignal;
}): AsyncGenerator<AgentChunk> {
  const { backend, release } = await openClaudeBackend();
  try {
    yield* streamClaudeAgent({
      backend,
      system: input.system,
      messages: input.messages,
      aiSdkTools: input.tools,
      remoteMcp: input.remoteMcp,
      audience: input.audience,
      maxTurns: input.maxSteps,
      thinking: true,
      abortSignal: input.abortSignal,
    });
  } finally {
    release();
  }
}

/**
 * Structured output: Claude Code has no schema-constrained decoding, so instruct
 * strict JSON, then parse + zod-validate (one retry). Callers handle failures.
 */
export async function generateAiObject<T>(input: {
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const system =
    (input.system ? input.system + "\n\n" : "") +
    "Respond with ONLY a single valid JSON object that satisfies the request. " +
    "No markdown, no code fences, no commentary — just the JSON.";
  let lastErr = "no output";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await generateAiText({ system, prompt: input.prompt });
    const parsed = input.schema.safeParse(extractJson(text));
    if (parsed.success) return parsed.data;
    lastErr = parsed.error?.message ?? "invalid JSON";
  }
  throw new Error(`The model did not return valid structured output: ${lastErr}`);
}
