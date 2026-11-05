import "server-only";
import type { AiMcpServer } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getBoolSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import type { RemoteMcp } from "@/lib/claude-cli";
import type { AiOpResult } from "@/lib/ai-operations/types";
import type { AssistantProposal } from "@/lib/actions/ai-assistant";
import type { AiMcpMode, AiMcpTransport } from "@/lib/constants";
import {
  approvedCallProblem,
  capDiscoveredTools,
  coerceMinRole,
  decideRemoteToolUse,
  mcpCallLabel,
  planRemoteTools,
  PROPOSED_MESSAGE,
  remoteServerProblem,
  serversForRole,
  type RemoteMcpServer,
  type RemoteMcpTool,
} from "@/lib/sable-mcp-policy";

/**
 * Sable's remote MCP servers (Settings › Sable): tool discovery, the per-run
 * permission policy handed to the Claude Code harness, and the execution of an
 * approved call. Remote HTTP/SSE servers only — never local commands. A server
 * is an external destination, so nothing here runs unless AI_ALLOW_EXTERNAL is
 * on. The rules themselves live in lib/sable-mcp-policy.ts.
 */

const DISCOVERY_TIMEOUT_MS = 10_000;
/** All of a chat turn's discovery shares one deadline; a slower server sits the turn out. */
const TURN_DISCOVERY_DEADLINE_MS = 5_000;
const CALL_TIMEOUT_MS = 60_000;
const TOOL_CACHE_TTL_MS = 5 * 60_000;
/** A server that failed discovery is not retried for this long (unless edited). */
const FAILURE_CACHE_TTL_MS = 60_000;
/** Bounds a misbehaving server that keeps returning a cursor. */
const MAX_TOOL_PAGES = 20;
const SUMMARY_TEXT_MAX = 300;

/** A run's remote MCP policy plus the proposals it produced. */
export type SableRemoteMcp = RemoteMcp & { proposals(): AssistantProposal[] };

/** Decrypt a server's stored header JSON. Throws when the blob can't be read. */
export function decodeHeaders(blob: string | null): Record<string, string> {
  if (!blob) return {};
  const json = decryptSecret(blob);
  if (json === null) {
    throw new Error("The stored headers could not be decrypted (was SETTINGS_ENCRYPTION_KEY changed?).");
  }
  return JSON.parse(json) as Record<string, string>;
}

export function encodeHeaders(headers: Record<string, string>): string | null {
  return Object.keys(headers).length ? encryptSecret(JSON.stringify(headers)) : null;
}

/**
 * A stored server, decrypted and re-validated: rows can be hand-edited, so an
 * address or header the admin form would reject throws here.
 */
export function toRemoteServer(row: AiMcpServer): RemoteMcpServer {
  const server: RemoteMcpServer = {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport as AiMcpTransport,
    headers: decodeHeaders(row.headers),
    mode: row.mode as AiMcpMode,
    minRole: coerceMinRole(row.minRole),
  };
  const problem = remoteServerProblem(server);
  if (problem) throw new Error(`The MCP server "${row.name}" is misconfigured: ${problem}`);
  return server;
}

/** Connect an MCP client to the server, run `work`, and always close the connection. */
async function withMcpClient<T>(server: RemoteMcpServer, work: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(server.url);
  const requestInit = { headers: server.headers };
  const transport =
    server.transport === "sse"
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });
  const client = new Client({ name: "servio-sable", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: DISCOVERY_TIMEOUT_MS });
    return await work(client);
  } finally {
    // A failed close must not mask the result or the original error.
    await client.close().catch(() => undefined);
  }
}

/** The server's tools, read-only flag taken from the MCP `readOnlyHint` annotation. */
export async function discoverTools(server: RemoteMcpServer): Promise<RemoteMcpTool[]> {
  return withMcpClient(server, async (client) => {
    const tools: RemoteMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const res = await client.listTools(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
      for (const t of res.tools) {
        tools.push({ name: t.name, description: t.description, readOnly: t.annotations?.readOnlyHint === true });
      }
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return capDiscoveredTools(tools);
  });
}

/**
 * Discovery per server id, for one version of it (updatedAt): a newer version
 * replaces the entry, and saving or deleting a server forgets it at once.
 * Failures are cached too, briefly, so a dead server doesn't slow every turn.
 */
type CachedDiscovery = { version: number; expires: number } & ({ tools: RemoteMcpTool[] } | { error: string });
const toolCache = new Map<string, CachedDiscovery>();

/** Drop a server's cached discovery (call after saving or deleting it). */
export function forgetMcpServerTools(id: string): void {
  toolCache.delete(id);
}

async function cachedTools(row: AiMcpServer, server: RemoteMcpServer): Promise<RemoteMcpTool[]> {
  const version = row.updatedAt.getTime();
  const hit = toolCache.get(row.id);
  if (hit && hit.version === version && hit.expires > Date.now()) {
    if ("error" in hit) throw new Error(`${hit.error} (recent failure, not retried yet)`);
    return hit.tools;
  }
  try {
    const tools = await discoverTools(server);
    toolCache.set(row.id, { version, expires: Date.now() + TOOL_CACHE_TTL_MS, tools });
    return tools;
  } catch (e) {
    toolCache.set(row.id, { version, expires: Date.now() + FAILURE_CACHE_TTL_MS, error: errorText(e) });
    throw e;
  }
}

/**
 * The remote MCP servers (and the policy over their tools) for one console chat
 * turn of a user with `role`, or null when there are none to offer. A server
 * that can't be reached in time is left out of this turn rather than failing it.
 */
export async function resolveRemoteMcp(role: string): Promise<SableRemoteMcp | null> {
  if (!(await getBoolSetting("AI_ALLOW_EXTERNAL"))) return null;
  const rows = serversForRole(await db.aiMcpServer.findMany({ orderBy: { name: "asc" } }), role);
  const discovered = await discoverWithinDeadline(rows);
  const usable = discovered.filter((d): d is NonNullable<typeof d> => d !== null);
  return usable.length ? createRemoteMcpRun(usable) : null;
}

/** Discover every row in parallel under ONE deadline; a late server is left out (its discovery still fills the cache). */
async function discoverWithinDeadline(rows: AiMcpServer[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), TURN_DISCOVERY_DEADLINE_MS);
  });
  try {
    return await Promise.all(
      rows.map(async (row) => {
        const result = await Promise.race([discoverForRun(row), deadline]);
        if (result !== "late") return result;
        console.warn(`[sable-mcp] "${row.name}" left out of this turn: discovery took over ${TURN_DISCOVERY_DEADLINE_MS} ms`);
        return null;
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function discoverForRun(row: AiMcpServer) {
  try {
    const server = toRemoteServer(row);
    return { server, tools: await cachedTools(row, server) };
  } catch (e) {
    console.warn(`[sable-mcp] "${row.name}" left out of this turn: ${errorText(e)}`);
    return null;
  }
}

/**
 * The per-run harness policy for discovered servers. APPROVAL write calls are
 * denied to the model and recorded as proposals; the chat shows each one as an
 * approval card in place of the denial. A server whose address or headers fail
 * validation is never handed to Claude Code (it would expand `${VAR}` in them).
 */
export function createRemoteMcpRun(
  discovered: { server: RemoteMcpServer; tools: RemoteMcpTool[] }[],
): SableRemoteMcp {
  const servers = discovered.filter(({ server }) => {
    const problem = remoteServerProblem(server);
    if (problem) console.warn(`[sable-mcp] "${server.name}" left out of this turn: ${problem}`);
    return problem === null;
  });
  const plan = planRemoteTools(servers);
  const proposals = new Map<string, AssistantProposal>();
  return {
    servers: Object.fromEntries(
      servers.map(({ server }) => [
        server.name,
        // alwaysLoad: the tools are in the first prompt (the harness has no tool search).
        { type: server.transport, url: server.url, headers: server.headers, alwaysLoad: true },
      ]),
    ),
    allowedTools: plan.allowedTools,
    disallowedTools: plan.disallowedTools,
    canUseTool: async (toolName, input, { toolUseID }) => {
      const decision = decideRemoteToolUse(plan, toolName, input, toolUseID);
      if (decision.behavior === "allow") return { behavior: "allow", updatedInput: input };
      if (decision.behavior === "deny") return { behavior: "deny", message: decision.message };
      proposals.set(toolUseID, decision.proposal);
      return { behavior: "deny", message: PROPOSED_MESSAGE };
    },
    interceptedResult: (toolCallId) => {
      const proposal = proposals.get(toolCallId);
      return proposal ? { ok: true, proposal } : undefined;
    },
    proposals: () => [...proposals.values()],
  };
}

export type McpCall = { serverId: string; server: string; tool: string; input: Record<string, unknown> };

/**
 * Run an approved `mcp.call` proposal. Everything is re-checked against the
 * CURRENT configuration: the privacy gate, the very server the proposal named
 * (id and name) still enabled and not read-only, and the approver's fresh role
 * against its minRole. Every attempt that reaches the server is audited.
 */
export async function executeApprovedMcpCall(
  call: McpCall,
  actor: { userId: string; role: string },
): Promise<AiOpResult> {
  if (!(await getBoolSetting("AI_ALLOW_EXTERNAL"))) {
    return { ok: false, error: "MCP servers are off: external AI destinations are not allowed (AI_ALLOW_EXTERNAL)." };
  }
  const row = await db.aiMcpServer.findUnique({ where: { id: call.serverId } });
  const problem = approvedCallProblem(row, call, actor.role);
  if (problem) return { ok: false, error: problem };
  const server = row as AiMcpServer; // approvedCallProblem rejects a missing row

  const label = mcpCallLabel(call.server, call.tool);
  const outcome = await callRemoteTool(server, call, label);
  await writeAudit({
    userId: actor.userId,
    action: "UPDATE",
    entity: "AiMcpServer",
    entityId: server.id,
    summary: outcome.ok
      ? `Ran ${label} (approved Sable proposal)`
      : `Failed to run ${label} (approved Sable proposal): ${truncate(outcome.error, SUMMARY_TEXT_MAX)}`,
    meta: { tool: call.tool, outcome: outcome.ok ? "success" : "error" },
  });
  return outcome;
}

async function callRemoteTool(row: AiMcpServer, call: McpCall, label: string): Promise<AiOpResult> {
  try {
    const result = await withMcpClient(toRemoteServer(row), (client) =>
      client.callTool({ name: call.tool, arguments: call.input }, undefined, { timeout: CALL_TIMEOUT_MS }),
    );
    const text = resultText(result.content);
    if (result.isError) return { ok: false, error: text || `${label} reported an error.` };
    const summary = text ? `${label}: ${truncate(text, SUMMARY_TEXT_MAX)}` : `Ran ${label}`;
    return { ok: true, summary, data: { content: result.content } };
  } catch (e) {
    return { ok: false, error: `${label} failed: ${errorText(e)}` };
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const part = c as { type?: string; text?: string };
      return part.type === "text" ? (part.text ?? "") : "";
    })
    .join("\n")
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
