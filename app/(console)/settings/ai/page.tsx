import type { Metadata } from "next";
import { SableMark } from "@/components/sable-mark";
import { requireRole } from "@/lib/session";
import { getSetting, getBoolSetting, settingIsSet } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveAiSettings } from "@/lib/actions/settings";
import { AI_ASSISTANT_NAME } from "@/lib/constants";

export const metadata: Metadata = { title: "AI settings" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  await requireRole("ADMIN");
  const [
    provider,
    allowExternal,
    model,
    ollamaUrl,
    ollamaModel,
    maxTokens,
    teaser,
    ticketTriage,
    anthropicSet,
    openaiSet,
    webSearchProvider,
    tavilySet,
    braveSet,
  ] = await Promise.all([
    getSetting("AI_PROVIDER", "anthropic"),
    getBoolSetting("AI_ALLOW_EXTERNAL"),
    getSetting("AI_MODEL", ""),
    getSetting("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    getSetting("OLLAMA_MODEL", "llama3.1"),
    getSetting("AI_MAX_OUTPUT_TOKENS", "1024"),
    getBoolSetting("AI_TEASER"),
    getBoolSetting("AI_TICKET_TRIAGE", true),
    settingIsSet("ANTHROPIC_API_KEY"),
    settingIsSet("OPENAI_API_KEY"),
    getSetting("WEB_SEARCH_PROVIDER", "auto"),
    settingIsSet("TAVILY_API_KEY"),
    settingIsSet("BRAVE_API_KEY"),
  ]);

  return (
    <>
      <PageHeader
        icon={SableMark}
        title={`${AI_ASSISTANT_NAME} (AI assistant)`}
        description="Provider, model and keys for the built-in AI assistant. External providers require the privacy toggle."
      />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveAiSettings}
          fields={[
            {
              type: "select",
              name: "AI_PROVIDER",
              label: "Provider",
              defaultValue: provider ?? "anthropic",
              options: [
                { value: "anthropic", label: "Anthropic (external)" },
                { value: "openai", label: "OpenAI-compatible (external)" },
                { value: "ollama", label: "Ollama (local, on-box)" },
                { value: "claude-code", label: "Claude subscription (local Claude CLI)" },
              ],
            },
            {
              type: "switch",
              name: "AI_ALLOW_EXTERNAL",
              label: "Allow external providers",
              defaultChecked: allowExternal,
              hint: "Required for Anthropic/OpenAI. Ollama stays on-box. “Claude subscription” drives your logged-in `claude` CLI (Pro/Max) — data leaves the box, and it's a grey area vs. Anthropic's terms.",
            },
            {
              type: "text",
              name: "AI_MODEL",
              label: "Model",
              defaultValue: model ?? "",
              placeholder: "Leave blank for the provider default",
              hint: "For “Claude subscription”: use `claude-sonnet-5` or `claude-opus-5` for the latest models. The `sonnet`/`opus` aliases currently resolve to 4.x, so specify the full 5 id. Blank = sonnet.",
            },
            { type: "password", name: "ANTHROPIC_API_KEY", label: "Anthropic API key", isSet: anthropicSet },
            { type: "password", name: "OPENAI_API_KEY", label: "OpenAI API key", isSet: openaiSet },
            {
              type: "text",
              name: "OLLAMA_BASE_URL",
              label: "Ollama base URL",
              defaultValue: ollamaUrl ?? "",
              placeholder: "http://localhost:11434/v1",
            },
            {
              type: "text",
              name: "OLLAMA_MODEL",
              label: "Ollama model",
              defaultValue: ollamaModel ?? "",
              placeholder: "llama3.1",
            },
            {
              type: "number",
              name: "AI_MAX_OUTPUT_TOKENS",
              label: "Max output tokens",
              defaultValue: maxTokens ?? "1024",
              placeholder: "1024",
            },
            {
              type: "switch",
              name: "AI_TEASER",
              label: "Teaser mode",
              defaultChecked: teaser,
              hint: "Show AI buttons as a preview even when not configured.",
            },
            {
              type: "switch",
              name: "AI_TICKET_TRIAGE",
              label: "In-ticket triage suggestions",
              defaultChecked: ticketTriage,
              hint: `When on, ${AI_ASSISTANT_NAME} suggests priority, type, team and category inline when you open a ticket. Turn off to hide those suggestions — chat and request handling stay on.`,
            },
            {
              type: "select",
              name: "WEB_SEARCH_PROVIDER",
              label: "Web search provider",
              defaultValue: webSearchProvider ?? "auto",
              options: [
                { value: "auto", label: "Auto (use a configured key, else DuckDuckGo)" },
                { value: "tavily", label: "Tavily (API key)" },
                { value: "brave", label: "Brave Search (API key)" },
                { value: "duckduckgo", label: "DuckDuckGo (keyless, best-effort)" },
              ],
              hint: `${AI_ASSISTANT_NAME}'s web_search tool. A real provider gives cleaner, more reliable results than the keyless DuckDuckGo scraper. The search query leaves the box regardless of provider.`,
            },
            { type: "password", name: "TAVILY_API_KEY", label: "Tavily API key", isSet: tavilySet },
            { type: "password", name: "BRAVE_API_KEY", label: "Brave Search API key", isSet: braveSet },
          ]}
        />
      </PageBody>
    </>
  );
}
