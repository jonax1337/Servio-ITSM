"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { encryptionAvailable } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { decodeHeaders, discoverTools, encodeHeaders, forgetMcpServerTools } from "@/lib/sable-mcp";
import {
  coerceMinRole,
  mcpServerInputSchema,
  mergeHeaders,
  type McpMinRole,
  type McpServerInput,
  type RemoteMcpServer,
  type RemoteMcpTool,
} from "@/lib/sable-mcp-policy";
import type { AiMcpMode, AiMcpTransport } from "@/lib/constants";

/**
 * Admin CRUD for Sable's remote MCP servers (Settings › Sable). Header values
 * are secrets: stored encrypted and never sent back — the client only sees
 * header NAMES, and a blank value on save keeps the stored one (same origin only).
 */

const SETTINGS_PATH = "/settings/ai";

/** A configured server as the admin UI sees it (no header values). */
export type McpServerView = {
  id: string;
  name: string;
  url: string;
  transport: AiMcpTransport;
  mode: AiMcpMode;
  minRole: McpMinRole;
  enabled: boolean;
  headerNames: string[];
};

export type McpSaveResult = { ok: true; id: string } | { ok: false; error: string };
export type McpTestResult = { ok: true; tools: RemoteMcpTool[] } | { ok: false; error: string };

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return null;
  return me;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function listMcpServers(): Promise<McpServerView[]> {
  if (!(await requireAdmin())) return [];
  const rows = await db.aiMcpServer.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport as AiMcpTransport,
    mode: row.mode as AiMcpMode,
    minRole: coerceMinRole(row.minRole),
    enabled: row.enabled,
    headerNames: headerNamesOf(row.headers),
  }));
}

function headerNamesOf(blob: string | null): string[] {
  try {
    return Object.keys(decodeHeaders(blob));
  } catch {
    // Undecryptable (rotated key): show none, so the admin re-enters them.
    return [];
  }
}

/** Validate the form and resolve its headers against the stored ones (blank = keep). */
async function resolveInput(
  raw: McpServerInput,
): Promise<
  { ok: true; id?: string; server: Omit<RemoteMcpServer, "id">; enabled: boolean } | { ok: false; error: string }
> {
  const parsed = mcpServerInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  let stored: { url: string; headers: Record<string, string> } | null = null;
  if (input.id) {
    const row = await db.aiMcpServer.findUnique({ where: { id: input.id }, select: { url: true, headers: true } });
    if (!row) return { ok: false, error: "This server no longer exists." };
    let headers: Record<string, string>;
    try {
      headers = decodeHeaders(row.headers);
    } catch {
      headers = {}; // rotated key: blank values then fail "needs a value", prompting re-entry
    }
    stored = { url: row.url, headers };
  }
  const merged = mergeHeaders(input.headers, stored, input.url);
  if (!merged.ok) return merged;

  const { name, url, transport, mode, minRole } = input;
  return {
    ok: true,
    id: input.id,
    server: { name, url, transport, mode, minRole, headers: merged.headers },
    enabled: input.enabled,
  };
}

export async function saveMcpServer(raw: McpServerInput): Promise<McpSaveResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Not authorised" };
  const resolved = await resolveInput(raw);
  if (!resolved.ok) return resolved;
  const { id, enabled, server } = resolved;
  const { headers, ...fields } = server;
  if (Object.keys(headers).length && !encryptionAvailable()) {
    return { ok: false, error: "Encryption key not configured — set a valid SETTINGS_ENCRYPTION_KEY to store headers." };
  }

  const clash = await db.aiMcpServer.findUnique({ where: { name: fields.name }, select: { id: true } });
  if (clash && clash.id !== id) return { ok: false, error: `A server named "${fields.name}" already exists.` };

  const data = { ...fields, enabled, headers: encodeHeaders(headers) };
  const row = id
    ? await db.aiMcpServer.update({ where: { id }, data })
    : await db.aiMcpServer.create({ data });
  forgetMcpServerTools(row.id);

  await writeAudit({
    userId: me.id,
    action: id ? "UPDATE" : "CREATE",
    entity: "AiMcpServer",
    entityId: row.id,
    summary: `${id ? "Updated" : "Added"} MCP server "${row.name}" (${row.mode}, ${row.minRole}+)`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, id: row.id };
}

/** ConfirmButton action: deletes the server named by the `id` field. */
export async function deleteMcpServer(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Not authorised" };
  const id = String(fd.get("id") ?? "");
  const row = await db.aiMcpServer.findUnique({ where: { id }, select: { name: true } });
  if (!row) return { ok: false, error: "This server no longer exists." };
  await db.aiMcpServer.delete({ where: { id } });
  forgetMcpServerTools(id);
  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "AiMcpServer",
    entityId: id,
    summary: `Removed MCP server "${row.name}"`,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/**
 * Connect with the form's CURRENT values (stored header values fill blanks) and
 * list the server's tools with their read-only flag — without saving anything.
 */
export async function testMcpServer(raw: McpServerInput): Promise<McpTestResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorised" };
  const resolved = await resolveInput(raw);
  if (!resolved.ok) return resolved;
  try {
    const tools = await discoverTools({ id: resolved.id ?? "draft", ...resolved.server });
    return { ok: true, tools };
  } catch (e) {
    return { ok: false, error: `Could not list the server's tools: ${errorMessage(e, "connection failed")}` };
  }
}
