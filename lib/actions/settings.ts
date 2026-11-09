"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { CHANGE_SELF_APPROVAL_SETTING, PORTAL_TRIAGE_GROUP_SETTING, TICKET_CLOSED_EMAIL_SETTING, getSetting, setSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { CHANGE_SELF_APPROVAL_MODES } from "@/lib/approval-rules";
import { TICKET_AUTO_CLOSE_DAYS_SETTING, parseAutoCloseDaysInput } from "@/lib/auto-close-rules";
import { encryptionAvailable } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { aiConfigured, generateAiText, type AiProvider } from "@/lib/ai";
import { listModels, type AiModelList } from "@/lib/ai-models";
import { checkForUpdates, updateChecksEnabled } from "@/lib/updates";
import { normalizeLocale } from "@/lib/i18n/config";
import {
  INBOUND_ALLOWED_DOMAINS_SETTING,
  INBOUND_DENY_LIST_SETTING,
  INBOUND_REJECT_AUTOREPLY_SETTING,
  INBOUND_REJECT_REQUIRE_AUTH_SETTING,
  INBOUND_SENDER_POLICY_SETTING,
  senderPolicyInput,
} from "@/lib/mail-inbound/policy";
import {
  IMAP_PROCESSED_ACTION_SETTING,
  IMAP_PROCESSED_FOLDER_SETTING,
  IMAP_RETENTION_DAYS_SETTING,
  processingInput,
} from "@/lib/mail-inbound/disposition";
import { ATTACHMENT_EXTRA_EXTENSIONS_SETTING, parseExtraExtensions } from "@/lib/files";
import { BACKUP_SETTING, parseBackupSchedule, parseRetentionInput } from "@/lib/backup-rules";
import { isValidTimeZone } from "@/lib/oncall-rules";

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
  // "none" → "" = fall back to the group named "Service Desk".
  const rawTriage = str(fd, PORTAL_TRIAGE_GROUP_SETTING);
  const triageGroupId = rawTriage === "none" ? "" : rawTriage;
  if (triageGroupId && !(await db.group.findUnique({ where: { id: triageGroupId }, select: { id: true } }))) {
    return { error: "Pick an existing group as the triage team." };
  }
  const result = await persist(
    me.id,
    [
      { key: "APP_NAME", value: str(fd, "APP_NAME") },
      { key: "APP_URL", value: str(fd, "APP_URL") },
      // Unsupported/blank → "" = fall back to env APP_LOCALE, then English.
      { key: "APP_LOCALE", value: normalizeLocale(str(fd, "APP_LOCALE")) ?? "" },
      { key: PORTAL_TRIAGE_GROUP_SETTING, value: triageGroupId },
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

/** Who may open a ticket by email, the deny-list and the rejection answer (Settings › Inbound mail). */
export async function saveInboundPolicySettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const input = senderPolicyInput({
    policy: str(fd, INBOUND_SENDER_POLICY_SETTING),
    allowedDomains: str(fd, INBOUND_ALLOWED_DOMAINS_SETTING),
    denyList: str(fd, INBOUND_DENY_LIST_SETTING),
  });
  if (!input.ok) return { error: input.error };
  return persist(
    me.id,
    [
      { key: INBOUND_SENDER_POLICY_SETTING, value: input.policy },
      { key: INBOUND_ALLOWED_DOMAINS_SETTING, value: input.allowedDomains.join(", ") },
      { key: INBOUND_DENY_LIST_SETTING, value: input.denyList.join(", ") },
      { key: INBOUND_REJECT_AUTOREPLY_SETTING, value: bool(fd, INBOUND_REJECT_AUTOREPLY_SETTING) },
      { key: INBOUND_REJECT_REQUIRE_AUTH_SETTING, value: bool(fd, INBOUND_REJECT_REQUIRE_AUTH_SETTING) },
    ],
    `Updated inbound sender policy (${input.policy}, ${input.allowedDomains.length} allowed domains, ${input.denyList.length} deny-list entries)`,
    "/settings/inbound",
  );
}

/** What happens to fetched messages on the mail server, and how long they are kept (Settings › Inbound mail). */
export async function saveInboundProcessingSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const input = processingInput({
    disposition: str(fd, IMAP_PROCESSED_ACTION_SETTING),
    folder: str(fd, IMAP_PROCESSED_FOLDER_SETTING),
    retentionDays: str(fd, IMAP_RETENTION_DAYS_SETTING),
    pollFolder: (await getSetting("IMAP_FOLDER")) ?? "INBOX",
  });
  if (!input.ok) return { error: input.error };
  return persist(
    me.id,
    [
      { key: IMAP_PROCESSED_ACTION_SETTING, value: input.disposition },
      { key: IMAP_PROCESSED_FOLDER_SETTING, value: input.folder },
      { key: IMAP_RETENTION_DAYS_SETTING, value: input.retentionDays ? String(input.retentionDays) : "" },
    ],
    `Updated processed-mail handling (${input.disposition}, retention ${input.retentionDays || "off"})`,
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
      { key: "AI_ENABLED", value: bool(fd, "AI_ENABLED") },
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
  const extra = parseExtraExtensions(str(fd, ATTACHMENT_EXTRA_EXTENSIONS_SETTING));
  if (extra.denied.length) return { error: `These file types can never be allowed: ${extra.denied.join(", ")}.` };
  if (extra.invalid.length) return { error: `Not a valid file extension: ${extra.invalid.join(", ")}.` };
  return persist(
    me.id,
    [
      { key: "MAX_UPLOAD_MB", value: str(fd, "MAX_UPLOAD_MB") },
      { key: "GOTENBERG_URL", value: str(fd, "GOTENBERG_URL") },
      { key: ATTACHMENT_EXTRA_EXTENSIONS_SETTING, value: extra.extensions.join(", ") },
    ],
    "Updated upload settings",
    "/settings/uploads",
  );
}

export async function saveChangeSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const mode = str(fd, CHANGE_SELF_APPROVAL_SETTING);
  if (!(CHANGE_SELF_APPROVAL_MODES as readonly string[]).includes(mode)) {
    return { error: "Pick a self-approval mode." };
  }
  // OFF is stored, not dropped: an empty row would let an environment value switch it back on.
  return persist(
    me.id,
    [{ key: CHANGE_SELF_APPROVAL_SETTING, value: mode }],
    `Updated change management settings (self-approval: ${mode})`,
    "/settings/changes",
  );
}

export async function saveTicketSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const parsed = parseAutoCloseDaysInput(str(fd, TICKET_AUTO_CLOSE_DAYS_SETTING));
  if ("error" in parsed) return { error: parsed.error };
  const closedEmail = bool(fd, TICKET_CLOSED_EMAIL_SETTING);
  // 0 is stored, not dropped: an empty row would let an environment value switch it back on.
  return persist(
    me.id,
    [
      { key: TICKET_AUTO_CLOSE_DAYS_SETTING, value: String(parsed.days) },
      { key: TICKET_CLOSED_EMAIL_SETTING, value: closedEmail },
    ],
    `Updated ticket settings (auto-close after ${parsed.days} days, closed email ${closedEmail === "true" ? "on" : "off"})`,
    "/settings/tickets",
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

export async function saveBackupSettings(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };
  const schedule = str(fd, BACKUP_SETTING.schedule);
  const parsedSchedule = parseBackupSchedule(schedule);
  if (!parsedSchedule.ok) return { error: parsedSchedule.error };
  const timezone = str(fd, BACKUP_SETTING.timezone);
  if (timezone && !isValidTimeZone(timezone)) return { error: "Unknown time zone: use an IANA name such as UTC or America/New_York." };
  const retention = parseRetentionInput(str(fd, BACKUP_SETTING.keepCount), str(fd, BACKUP_SETTING.keepDays));
  if (!retention.ok) return { error: retention.error };
  const enabled = bool(fd, BACKUP_SETTING.enabled);
  const includeUploads = bool(fd, BACKUP_SETTING.includeUploads);
  // Switches and numbers are stored, not dropped: an empty row would let an environment value take over again.
  return persist(
    me.id,
    [
      { key: BACKUP_SETTING.enabled, value: enabled },
      { key: BACKUP_SETTING.schedule, value: schedule },
      { key: BACKUP_SETTING.timezone, value: timezone },
      { key: BACKUP_SETTING.keepCount, value: String(retention.keepCount) },
      { key: BACKUP_SETTING.keepDays, value: String(retention.keepDays) },
      { key: BACKUP_SETTING.includeUploads, value: includeUploads },
    ],
    `Updated backup settings (${enabled === "true" ? "on" : "off"}, schedule ${schedule || "default"}${timezone ? ` ${timezone}` : ""}, keep ${retention.keepCount} / ${retention.keepDays} days, uploads ${includeUploads === "true" ? "included" : "excluded"})`,
    "/settings/backups",
  );
}
