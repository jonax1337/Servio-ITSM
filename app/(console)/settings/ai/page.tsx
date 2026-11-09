import type { Metadata } from "next";
import { SableMark } from "@/components/sable-mark";
import { requireRole } from "@/lib/session";
import { getSetting, getBoolSetting, settingIsSet } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { AiSettingsForm, type AiSettingsValues } from "@/components/settings/ai-settings-form";
import { aiConfigured, aiEnabled } from "@/lib/ai";
import { listSableSkills } from "@/lib/sable-workspace";
import { listMcpServers } from "@/lib/actions/sable-mcp";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("ai.metaTitle") };
}
export const dynamic = "force-dynamic";

const PROVIDERS = new Set<AiSettingsValues["provider"]>(["claude-code", "anthropic", "openai", "ollama"]);

function asProvider(value: string | null): AiSettingsValues["provider"] {
  const v = (value ?? "").toLowerCase() === "claude-cli" ? "claude-code" : (value ?? "").toLowerCase();
  return PROVIDERS.has(v as AiSettingsValues["provider"]) ? (v as AiSettingsValues["provider"]) : "anthropic";
}

export default async function AiSettingsPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [
    enabled,
    provider,
    allowExternal,
    model,
    ollamaUrl,
    ollamaModel,
    maxTokens,
    teaser,
    ticketTriage,
    webSearchProvider,
    anthropic,
    openai,
    claudeToken,
    tavily,
    brave,
    configured,
    skills,
    mcpServers,
  ] = await Promise.all([
    aiEnabled(),
    getSetting("AI_PROVIDER", "anthropic"),
    getBoolSetting("AI_ALLOW_EXTERNAL"),
    getSetting("AI_MODEL", ""),
    getSetting("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    getSetting("OLLAMA_MODEL", "llama3.1"),
    getSetting("AI_MAX_OUTPUT_TOKENS", ""),
    getBoolSetting("AI_TEASER"),
    getBoolSetting("AI_TICKET_TRIAGE", true),
    getSetting("WEB_SEARCH_PROVIDER", "auto"),
    settingIsSet("ANTHROPIC_API_KEY"),
    settingIsSet("OPENAI_API_KEY"),
    settingIsSet("CLAUDE_CODE_OAUTH_TOKEN"),
    settingIsSet("TAVILY_API_KEY"),
    settingIsSet("BRAVE_API_KEY"),
    aiConfigured(),
    listSableSkills(),
    listMcpServers(),
  ]);

  return (
    <>
      <PageHeader
        icon={SableMark}
        title={t("ai.title", { name: AI_ASSISTANT_NAME })}
        description={t("ai.description", { name: AI_ASSISTANT_NAME })}
      />
      <PageBody className="max-w-3xl">
        <AiSettingsForm
          configured={configured}
          skills={skills}
          mcpServers={mcpServers}
          values={{
            enabled,
            provider: asProvider(provider),
            model: model ?? "",
            maxTokens: maxTokens ?? "1024",
            allowExternal,
            teaser,
            ticketTriage,
            ollamaUrl: ollamaUrl ?? "",
            ollamaModel: ollamaModel ?? "",
            webSearchProvider: webSearchProvider ?? "auto",
          }}
          secrets={{ anthropic, openai, claudeToken, tavily, brave }}
        />
      </PageBody>
    </>
  );
}
