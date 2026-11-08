"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import { encryptionAvailable } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { aiConfigured, generateAiText, type AiProvider } from "@/lib/ai";
import { listModels, type AiModelList } from "@/lib/ai-models";
import { checkForUpdates, updateChecksEnabled } from "@/lib/updates";
import { normalizeLocale } from "@/lib/i18n/config";

export type ActionState = { error?: string; ok?: boolean } | undefined;

type Entry = {
  key: string;
  value: string;
  encrypted?: boolean;
  /** Secret fields: a blank submission keeps the stored value (don't wipe it). */
  keepIfEmpty?: boolean;
};

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return null;
  return me;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
// base-ui Switch submits "on" when checked, nothing when unchecked.
const bool = (fd: FormData, k: string) => (fd.get(k) === "on" ? "true" : "false");

async function persist(
  userId: string,
  entries: Entry[],
  summary: string,
  path: string,
): Promise<ActionState> {
  // Fail fast, before any write, if a secret will be stored but the encryption
  // key is missing/invalid — otherwise encryptSecret throws mid-loop and leaves
  // the table partially updated with no audit trail.
  const willWriteSecret = entries.some(
    (e) => e.encrypted && e.value !== "" && !(e.keepIfEmpty && e.value === ""),
  );
  if (willWriteSecret && !encryptionAvailable()) {
    return {
      error:
        "Encryption key not configured — set a valid SETTINGS_ENCRYPTION_KEY to store secrets.",
    };
  }

  try {
    for (const e of entries) {
      if (e.keepIfEmpty && e.value === "") continue;
      await setSetting(e.key, e.value, { encrypted: e.encrypted, userId });
    }
  } catch {
    return { error: "Could not save settings. Please try again." };
  }

  await writeAudit({
    userId,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: path,
    summary,
  });
  revalidatePath(path);
  return { ok: true };
}

export async function saveGeneralSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const result = await persist(
    me.id,
    [
      { key: "APP_NAME", value: str(fd, "APP_NAME") },
      { key: "APP_URL", value: str(fd, "APP_URL") },
      // Unsupported/blank → "" = fall back to env APP_LOCALE, then English.
      { key: "APP_LOCALE", value: normalizeLocale(str(fd, "APP_LOCALE")) ?? "" },
    ],
    "Updated general settings",
    "/settings/general",
  );
  // The default language changes every page for users on "auto".
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function saveEmailSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  return persist(
    me.id,
    [
      { key: "SMTP_HOST", value: str(fd, "SMTP_HOST") },
      { key: "SMTP_PORT", value: str(fd, "SMTP_PORT") },
      { key: "SMTP_SECURE", value: bool(fd, "SMTP_SECURE") },
      { key: "SMTP_USER", value: str(fd, "SMTP_USER") },
      { key: "SMTP_PASS", value: str(fd, "SMTP_PASS"), encrypted: true, keepIfEmpty: true },
      { key: "SMTP_FROM", value: str(fd, "SMTP_FROM") },
    ],
    "Updated email settings",
    "/settings/email",
  );
}

export async function saveInboundSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  return persist(
    me.id,
    [
      { key: "IMAP_ENABLED", value: bool(fd, "IMAP_ENABLED") },
      { key: "IMAP_HOST", value: str(fd, "IMAP_HOST") },
      { key: "IMAP_PORT", value: str(fd, "IMAP_PORT") },
      { key: "IMAP_SECURE", value: bool(fd, "IMAP_SECURE") },
      { key: "IMAP_USER", value: str(fd, "IMAP_USER") },
      { key: "IMAP_PASS", value: str(fd, "IMAP_PASS"), encrypted: true, keepIfEmpty: true },
      { key: "IMAP_FOLDER", value: str(fd, "IMAP_FOLDER") },
      { key: "IMAP_POLL_SECONDS", value: str(fd, "IMAP_POLL_SECONDS") },
      { key: "MAIL_PLUS_ADDRESSING", value: bool(fd, "MAIL_PLUS_ADDRESSING") },
    ],
    "Updated inbound mail settings",
    "/settings/inbound",
  );
}

export async function saveAiSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  return persist(
    me.id,
    [
      { key: "AI_PROVIDER", value: str(fd, "AI_PROVIDER") },
      { key: "AI_ALLOW_EXTERNAL", value: bool(fd, "AI_ALLOW_EXTERNAL") },
      { key: "AI_MODEL", value: str(fd, "AI_MODEL") },
      { key: "OLLAMA_BASE_URL", value: str(fd, "OLLAMA_BASE_URL") },
      { key: "OLLAMA_MODEL", value: str(fd, "OLLAMA_MODEL") },
      { key: "AI_MAX_OUTPUT_TOKENS", value: str(fd, "AI_MAX_OUTPUT_TOKENS") },
      { key: "AI_TEASER", value: bool(fd, "AI_TEASER") },
      { key: "AI_TICKET_TRIAGE", value: bool(fd, "AI_TICKET_TRIAGE") },
      { key: "ANTHROPIC_API_KEY", value: str(fd, "ANTHROPIC_API_KEY"), encrypted: true, keepIfEmpty: true },
      { key: "OPENAI_API_KEY", value: str(fd, "OPENAI_API_KEY"), encrypted: true, keepIfEmpty: true },
      {
        key: "CLAUDE_CODE_OAUTH_TOKEN",
        value: str(fd, "CLAUDE_CODE_OAUTH_TOKEN"),
        encrypted: true,
        keepIfEmpty: true,
      },
      // Web search: optional real provider (Tavily/Brave); blank → keyless DuckDuckGo.
      { key: "WEB_SEARCH_PROVIDER", value: str(fd, "WEB_SEARCH_PROVIDER") },
      { key: "TAVILY_API_KEY", value: str(fd, "TAVILY_API_KEY"), encrypted: true, keepIfEmpty: true },
      { key: "BRAVE_API_KEY", value: str(fd, "BRAVE_API_KEY"), encrypted: true, keepIfEmpty: true },
    ],
    "Updated AI settings",
    "/settings/ai",
  );
}

export type AiConnectionCheck =
  | { ok: true; latencyMs: number; reply: string }
  | { ok: false; error: string };

const CONNECTION_CHECK_REPLY_CHARS = 200;

/**
 * One real round trip through Sable's harness with the SAVED settings, so the
 * admin sees whether the provider, credentials and Claude Code actually work.
 */
export async function testAiConnection(): Promise<AiConnectionCheck> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) {
    return { ok: false, error: "Not configured yet: pick a provider and add its credentials, then save." };
  }
  const started = Date.now();
  try {
    const reply = await generateAiText({
      system: "You are a connectivity check. Answer in one short sentence.",
      prompt: "Reply with: Sable is online.",
    });
    return { ok: true, latencyMs: Date.now() - started, reply: reply.slice(0, CONNECTION_CHECK_REPLY_CHARS) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The AI request failed." };
  }
}

/** Long-lived tokens from `claude setup-token` look like `sk-ant-oat01-…`. */
const CLAUDE_TOKEN_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/**
 * Store a Claude subscription token (from `claude setup-token`, run on ANY
 * machine — the token is bound to the account, not the host) and switch Sable
 * to the subscription provider.
 */
export async function connectClaudeSubscription(token: string): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const value = token.trim();
  if (!CLAUDE_TOKEN_PATTERN.test(value)) {
    return { error: "That doesn't look like a Claude token. It starts with sk-ant- and is printed by `claude setup-token`." };
  }
  return persist(
    me.id,
    [
      { key: "AI_PROVIDER", value: "claude-code" },
      { key: "CLAUDE_CODE_OAUTH_TOKEN", value, encrypted: true },
    ],
    "Connected Claude subscription",
    "/settings/ai",
  );
}

export async function saveUploadSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  return persist(
    me.id,
    [
      { key: "MAX_UPLOAD_MB", value: str(fd, "MAX_UPLOAD_MB") },
      { key: "GOTENBERG_URL", value: str(fd, "GOTENBERG_URL") },
    ],
    "Updated upload settings",
    "/settings/uploads",
  );
}

export async function saveUpdateSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const saved = await persist(
    me.id,
    [
      { key: "UPDATE_CHECK_ENABLED", value: bool(fd, "UPDATE_CHECK_ENABLED") },
      { key: "UPDATE_REPOSITORY", value: str(fd, "UPDATE_REPOSITORY") },
      { key: "UPDATE_INCLUDE_PRERELEASES", value: bool(fd, "UPDATE_INCLUDE_PRERELEASES") },
    ],
    "Updated update-check settings",
    "/settings/updates",
  );
  // The cached releases belong to the old repository / pre-release choice: look again right away.
  if (!saved?.error && (await updateChecksEnabled())) await checkForUpdates();
  return saved;
}

/** Models offered by a provider, loaded with the SAVED credentials (admin-only). */
export async function listAiModels(provider: AiProvider): Promise<AiModelList> {
  const me = await requireAdmin();
  if (!me) return { models: [], error: "Not authorised" };
  return listModels(provider);
}
