import "server-only";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getBoolSetting, getSetting } from "@/lib/settings";
import { ensureSableWorkspace } from "@/lib/sable-workspace";
import { inheritedHostEnv } from "@/lib/claude-env";
import type { AiProvider } from "@/lib/ai";

/**
 * Model lists for the admin settings dropdown, fetched with the SAVED
 * credentials. Never throws: any failure becomes `error` (and, where useful,
 * a static fallback list), because typing a model id by hand always works.
 */

export type AiModelOption = { id: string; label: string };
export type AiModelList = { models: AiModelOption[]; error?: string };

const REQUEST_TIMEOUT_MS = 8000;
const ANTHROPIC_API = "https://api.anthropic.com/v1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Claude Code aliases and current ids, used when the live list is unavailable. */
const CLAUDE_FALLBACK_MODELS: AiModelOption[] = [
  { id: "sonnet", label: "Sonnet (latest alias)" },
  { id: "opus", label: "Opus (latest alias)" },
  { id: "haiku", label: "Haiku (latest alias)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-haiku-5", label: "Claude Haiku 5" },
];

/** External providers: listing their models would send the saved key off-box. */
const PRIVACY_GATED: readonly AiProvider[] = ["anthropic", "openai"];

export async function listModels(provider: AiProvider): Promise<AiModelList> {
  if (PRIVACY_GATED.includes(provider) && !(await getBoolSetting("AI_ALLOW_EXTERNAL"))) {
    return {
      models: [],
      error: "External AI destinations are off (AI_ALLOW_EXTERNAL), so the model list is not fetched. Type a model id instead.",
    };
  }
  try {
    switch (provider) {
      case "anthropic":
        return await listAnthropicModels();
      case "claude-code":
        return await listClaudeCodeModels();
      case "openai":
        return await listOpenAiCompatible(
          (await getSetting("OPENAI_BASE_URL")) || DEFAULT_OPENAI_BASE_URL,
          (await getSetting("OPENAI_API_KEY")) ?? undefined,
        );
      case "ollama":
        return await listOllamaModels((await getSetting("OLLAMA_BASE_URL")) || DEFAULT_OLLAMA_BASE_URL);
      default:
        return { models: [], error: `Unknown AI provider "${String(provider)}".` };
    }
  } catch (error) {
    return { models: [], error: describe(error) };
  }
}

// ---- Anthropic API ---------------------------------------------------------

async function listAnthropicModels(): Promise<AiModelList> {
  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey) return { models: [], error: "Save an Anthropic API key to load the model list." };
  const body = await getJson(`${ANTHROPIC_API}/models?limit=100`, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  const models = readData(body).map((m) => ({
    id: String(m.id),
    label: typeof m.display_name === "string" ? m.display_name : String(m.id),
  }));
  return { models };
}

// ---- Claude subscription (Claude Code) -------------------------------------

/** Asks the Claude Code CLI itself (same env and isolation as the harness) which models the account offers. */
async function listClaudeCodeModels(): Promise<AiModelList> {
  const token = await getSetting("CLAUDE_CODE_OAUTH_TOKEN");
  if (!token) {
    return { models: CLAUDE_FALLBACK_MODELS, error: "Connect a Claude subscription to load your models; showing common ones." };
  }
  const workspace = await ensureSableWorkspace();
  const env = inheritedHostEnv();
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.CLAUDE_CONFIG_DIR = workspace.configDir;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
  // Streaming input that never yields keeps the process alive for the control request.
  const idle = (async function* () {
    await new Promise<void>((resolve) => abortController.signal.addEventListener("abort", () => resolve()));
  })();
  const session = query({
    prompt: idle,
    options: {
      env,
      cwd: workspace.cwd,
      tools: [],
      settingSources: [],
      persistSession: false,
      abortController,
    },
  });
  try {
    const supported = await session.supportedModels();
    // "default" is the account default, which a blank model field already means.
    const models = supported.filter((m) => m.value !== "default").map((m) => ({ id: m.value, label: m.displayName || m.value }));
    return models.length > 0
      ? { models }
      : { models: CLAUDE_FALLBACK_MODELS, error: "Claude Code returned no models; showing common ones." };
  } catch (error) {
    return { models: CLAUDE_FALLBACK_MODELS, error: `Could not load models from Claude Code (${describe(error)}); showing common ones.` };
  } finally {
    clearTimeout(timer);
    session.close();
    abortController.abort();
  }
}

// ---- OpenAI-compatible / Ollama --------------------------------------------

async function listOpenAiCompatible(baseURL: string, apiKey: string | undefined): Promise<AiModelList> {
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const body = await getJson(`${trimSlash(baseURL)}/models`, headers);
  const models = readData(body)
    .map((m) => String(m.id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id }));
  return { models };
}

/** Ollama speaks the OpenAI list format under /v1 and its native one under /api/tags. */
async function listOllamaModels(baseURL: string): Promise<AiModelList> {
  try {
    return await listOpenAiCompatible(baseURL, undefined);
  } catch (openAiError) {
    try {
      const root = trimSlash(baseURL).replace(/\/v1$/, "");
      const body = (await getJson(`${root}/api/tags`, {})) as { models?: { name?: unknown }[] };
      const models = (body.models ?? []).map((m) => String(m.name)).map((id) => ({ id, label: id }));
      return { models };
    } catch {
      return { models: [], error: describe(openAiError) };
    }
  }
}

// ---- HTTP helpers ----------------------------------------------------------

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

/** The `data` array of an OpenAI/Anthropic-style list response. */
function readData(body: unknown): { id?: unknown; display_name?: unknown }[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("Unexpected response: no model list.");
  return data.filter((m): m is { id: unknown } => typeof m === "object" && m !== null && "id" in m);
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
