import { z } from "zod";
import { AI_MCP_MODES, AI_MCP_TRANSPORTS, type AiMcpMode, type AiMcpTransport } from "@/lib/constants";
import { roleAtLeast } from "@/lib/route-guard";
import { MCP_SERVER, parseRemoteToolName, remoteToolName } from "@/lib/claude-agent-events";
import type { AssistantProposal } from "@/lib/actions/ai-assistant";

/**
 * The pure rules behind Sable's remote MCP servers: who gets which server, which
 * of its tools the model may call directly, which become approval proposals, and
 * how an admin's server form is validated. Free of DB, network and SDK imports so
 * it stays unit-testable; lib/sable-mcp.ts does the I/O.
 */

/** Registry operation that runs an approved remote MCP tool call. */
export const MCP_CALL_OPERATION = "mcp.call";

/** Console roles a server can be restricted to (portal users never get MCP servers). */
export const MCP_MIN_ROLES = ["AGENT", "MANAGER", "ADMIN"] as const;
export type McpMinRole = (typeof MCP_MIN_ROLES)[number];

/** A slug without doubled separators, so `mcp__<name>__<tool>` parses back unambiguously. */
const SERVER_NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SERVER_NAME_MAX = 40;
/** RFC 7230 header field name, minus `$` (see NO_DOLLAR_MESSAGE). */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#%&'*+.^_`|~-]+$/;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 4096;
/**
 * Claude Code expands `${VAR}` in a remote server's URL and headers from its own
 * environment, so a `$` could exfiltrate host secrets to the server. No `$` at all.
 */
const NO_DOLLAR_MESSAGE = 'The URL and headers may not contain "$" (it would be expanded from the server environment).';

/** Tool names Servio accepts from a server; anything else is left out of the run. */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** A server listing more tools than this is left out of the run (prompt-size guard). */
export const MAX_TOOLS_PER_SERVER = 128;
const MAX_TOOL_DESCRIPTION = 1024;

/** Plain http:// is only accepted for these (URL.hostname keeps IPv6 brackets). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const METADATA_HOSTS = new Set(["metadata.google.internal", "[fd00:ec2::254]"]);
/** IPv4 169.254.0.0/16, IPv6 fe80::/10 and IPv4-mapped 169.254.x.x (URL normalises to hex). */
const LINK_LOCAL_HOST = /^(?:169\.254\.\d+\.\d+|\[fe[89ab][0-9a-f]:[^\]]*\]|\[::ffff:a9fe:[0-9a-f]+\])$/i;

export type RemoteMcpTool = { name: string; description?: string; readOnly: boolean };

/** A configured server with its secrets decrypted (server-side only). */
export type RemoteMcpServer = {
  id: string;
  name: string;
  url: string;
  transport: AiMcpTransport;
  headers: Record<string, string>;
  mode: AiMcpMode;
  minRole: McpMinRole;
};

/** Servers the acting console user may use: enabled and at least the server's minRole. */
export function serversForRole<T extends { enabled: boolean; minRole: string }>(servers: T[], role: string): T[] {
  return servers.filter((s) => s.enabled && roleAtLeast(role, coerceMinRole(s.minRole)));
}

/** Unknown stored roles fall back to the strictest gate. */
export function coerceMinRole(raw: string): McpMinRole {
  return (MCP_MIN_ROLES as readonly string[]).includes(raw) ? (raw as McpMinRole) : "ADMIN";
}

/**
 * Why a server's address may not be used, or null. Shared by the admin form and
 * every place that builds a connection from a stored row (rows can be hand-edited).
 */
export function mcpUrlProblem(raw: string): string | null {
  if (raw.includes("$")) return NO_DOLLAR_MESSAGE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid URL.";
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(host))) {
    return "The URL must start with https:// (plain http:// is only allowed for localhost).";
  }
  if (LINK_LOCAL_HOST.test(host) || METADATA_HOSTS.has(host)) {
    return "Link-local and cloud metadata addresses are not allowed.";
  }
  return null;
}

/** Why a configured server may not be connected (address or `$` in a header), or null. */
export function remoteServerProblem(server: Pick<RemoteMcpServer, "url" | "headers">): string | null {
  const headerHasDollar = Object.entries(server.headers).some(([k, v]) => k.includes("$") || v.includes("$"));
  return mcpUrlProblem(server.url) ?? (headerHasDollar ? NO_DOLLAR_MESSAGE : null);
}

/**
 * A server's discovered tools, bounded: throws when it lists more than
 * MAX_TOOLS_PER_SERVER, and truncates long descriptions.
 */
export function capDiscoveredTools(tools: RemoteMcpTool[]): RemoteMcpTool[] {
  if (tools.length > MAX_TOOLS_PER_SERVER) {
    throw new Error(`It lists more than ${MAX_TOOLS_PER_SERVER} tools.`);
  }
  return tools.map((t) =>
    t.description && t.description.length > MAX_TOOL_DESCRIPTION
      ? { ...t, description: `${t.description.slice(0, MAX_TOOL_DESCRIPTION)}…` }
      : t,
  );
}

type PlannedTool = { serverId: string; server: string; mode: AiMcpMode; tool: string; readOnly: boolean };

/** One run's view of its remote tools, keyed by Claude Code's tool name. */
export type RemoteToolPlan = {
  /** Run without asking: read-only tools, and every tool of a TRUSTED server. */
  allowedTools: string[];
  /** Hidden from the model: the non-read-only tools of a READ_ONLY server. */
  disallowedTools: string[];
  tools: Map<string, PlannedTool>;
};

/**
 * Split each server's discovered tools by its mode. APPROVAL write tools are in
 * neither list: the model sees them, and every call reaches the permission
 * callback, which turns it into a proposal.
 *
 * Unusable tools are hidden and never run: names outside TOOL_NAME_PATTERN, and
 * EVERY tool whose Claude Code name collides with another's after sanitising
 * (`issue.get` vs `issue_get`) — keeping either could run the other's policy.
 */
export function planRemoteTools(
  servers: { server: Pick<RemoteMcpServer, "id" | "name" | "mode">; tools: RemoteMcpTool[] }[],
): RemoteToolPlan {
  const plan: RemoteToolPlan = { allowedTools: [], disallowedTools: [], tools: new Map() };
  for (const { server, tools } of servers) {
    const { usable, rejectedNames } = usableTools(server.name, tools);
    plan.disallowedTools.push(...rejectedNames);
    for (const [name, tool] of usable) {
      plan.tools.set(name, {
        serverId: server.id,
        server: server.name,
        mode: server.mode,
        tool: tool.name,
        readOnly: tool.readOnly,
      });
      if (server.mode === "TRUSTED" || tool.readOnly) plan.allowedTools.push(name);
      else if (server.mode === "READ_ONLY") plan.disallowedTools.push(name);
    }
  }
  return plan;
}

/** One server's tools by Claude Code name, minus invalid and colliding ones (whose names are returned). */
function usableTools(
  server: string,
  tools: RemoteMcpTool[],
): { usable: Map<string, RemoteMcpTool>; rejectedNames: string[] } {
  const byName = new Map<string, RemoteMcpTool[]>();
  for (const tool of tools) {
    const name = remoteToolName(server, tool.name);
    byName.set(name, [...(byName.get(name) ?? []), tool]);
  }
  const usable = new Map<string, RemoteMcpTool>();
  const rejectedNames: string[] = [];
  for (const [name, [first, ...others]] of byName) {
    if (others.length === 0 && TOOL_NAME_PATTERN.test(first.name)) usable.set(name, first);
    else rejectedNames.push(name);
  }
  return { usable, rejectedNames };
}

export type ToolDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string }
  | { behavior: "propose"; proposal: AssistantProposal };

/** What the model is told when its call became a proposal instead of running. */
export const PROPOSED_MESSAGE =
  "Not executed. This action was sent to the user as an approval card and runs only if they click Approve. " +
  "Do not retry it; tell the user it is waiting for their approval.";
const UNAVAILABLE_MESSAGE = "This tool is not available in this chat.";
const READ_ONLY_MESSAGE = "Blocked: this MCP server is read-only in Servio, so only read-only tools may run.";

/**
 * The permission decision for one tool call that was not pre-allowed. Anything
 * the plan does not know (another server, a tool added since discovery, a
 * hallucinated name) is denied.
 */
export function decideRemoteToolUse(
  plan: RemoteToolPlan,
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
): ToolDecision {
  const entry = plan.tools.get(toolName);
  if (!entry) return { behavior: "deny", message: UNAVAILABLE_MESSAGE };
  if (entry.mode === "TRUSTED" || entry.readOnly) return { behavior: "allow" };
  if (entry.mode === "READ_ONLY") return { behavior: "deny", message: READ_ONLY_MESSAGE };
  return { behavior: "propose", proposal: buildMcpProposal(toolCallId, entry, input) };
}

/**
 * The approval card for a remote tool call: the `mcp.call` operation with the
 * call as its args. The server is pinned by id AND name (see approvedCallProblem).
 */
export function buildMcpProposal(
  id: string,
  call: { serverId: string; server: string; tool: string },
  input: Record<string, unknown>,
): AssistantProposal {
  const { serverId, server, tool } = call;
  return {
    id,
    operationId: MCP_CALL_OPERATION,
    args: { serverId, server, tool, input },
    label: mcpCallLabel(server, tool),
  };
}

/**
 * Why an approved `mcp.call` may not run against the server as it is NOW, or
 * null. The row must be the very server the proposal named (id and name), still
 * enabled and not read-only, and the approver must meet its minRole.
 */
export function approvedCallProblem(
  row: { id: string; name: string; enabled: boolean; minRole: string; mode: string } | null,
  call: { serverId: string; server: string },
  approverRole: string,
): string | null {
  if (!row || row.id !== call.serverId || row.name !== call.server || !row.enabled) {
    return `The MCP server "${call.server}" is no longer available.`;
  }
  if (!roleAtLeast(approverRole, coerceMinRole(row.minRole))) return "Not authorised.";
  if (row.mode === "READ_ONLY") return `The MCP server "${call.server}" is read-only, so this call can't run.`;
  return null;
}

export function mcpCallLabel(server: string, tool: string): string {
  return `${server} · ${tool}`;
}

/**
 * The approval proposal a tool result may show as a card. `propose_*` results
 * are Servio's own. A remote MCP tool's real output reaches the UI as plain text
 * (the event mapper never parses it), so an object with a `proposal` there can
 * only be the harness's substitute for an intercepted call; it must still be the
 * `mcp.call` proposal for this very call, under Servio's own label.
 */
export function approvalCardProposal(toolName: string, result: unknown): AssistantProposal | null {
  const proposal = (result as { proposal?: AssistantProposal } | null | undefined)?.proposal;
  if (!proposal || typeof proposal !== "object") return null;
  if (toolName.startsWith("propose_")) return proposal;
  const remote = parseRemoteToolName(toolName);
  const { server, tool } = (proposal.args ?? {}) as { server?: unknown; tool?: unknown };
  const isThisCall =
    remote !== null &&
    proposal.operationId === MCP_CALL_OPERATION &&
    server === remote.server &&
    typeof tool === "string" &&
    remoteToolName(remote.server, tool) === toolName;
  return isThisCall ? { ...proposal, label: mcpCallLabel(remote.server, tool) } : null;
}

/** Server-form input as the admin dialog sends it. A blank header value keeps the stored one. */
export const mcpServerInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(SERVER_NAME_MAX, `Name must be at most ${SERVER_NAME_MAX} characters.`)
    .regex(SERVER_NAME_PATTERN, "Name must be lowercase letters and digits, optionally separated by single - or _.")
    .refine((n) => n !== MCP_SERVER, `"${MCP_SERVER}" is reserved for Servio's own tools.`),
  url: z
    .string()
    .trim()
    .superRefine((u, ctx) => {
      const problem = mcpUrlProblem(u);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  transport: z.enum(AI_MCP_TRANSPORTS),
  mode: z.enum(AI_MCP_MODES),
  minRole: z.enum(MCP_MIN_ROLES),
  enabled: z.boolean(),
  headers: z
    .array(
      z.object({
        name: z.string().trim().regex(HEADER_NAME_PATTERN, "Header names may not contain spaces or special characters."),
        value: z
          .string()
          .max(MAX_HEADER_VALUE, "Header value is too long.")
          .refine((v) => !v.includes("$"), NO_DOLLAR_MESSAGE),
      }),
    )
    .max(MAX_HEADERS, `At most ${MAX_HEADERS} headers.`),
});
export type McpServerInput = z.input<typeof mcpServerInputSchema>;

/**
 * The headers to store: submitted rows win, a blank value keeps the stored value
 * of the same header (names compare case-insensitively, like HTTP), and stored
 * headers missing from the rows are dropped. Stored secrets are only reused for
 * the same origin: when the URL now points elsewhere, a blank value is an error,
 * so a secret can't be redirected to a new host without re-entering it.
 */
export function mergeHeaders(
  rows: { name: string; value: string }[],
  stored: { url: string; headers: Record<string, string> } | null,
  url: string,
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const storedByName = new Map(Object.entries(stored?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const sameOrigin = stored !== null && originOf(stored.url) === originOf(url);
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Header "${row.name}" is listed twice.` };
    seen.add(key);
    if (row.value === "" && storedByName.has(key) && !sameOrigin) {
      return {
        ok: false,
        error: `The server address changed: re-enter the value of header "${row.name}" (stored secrets are only reused for the same origin).`,
      };
    }
    const value = row.value === "" ? storedByName.get(key) : row.value;
    if (value === undefined) return { ok: false, error: `Header "${row.name}" needs a value.` };
    headers[row.name] = value;
  }
  return { ok: true, headers };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
