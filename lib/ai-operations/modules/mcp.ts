import { z } from "zod";
import { executeApprovedMcpCall } from "@/lib/sable-mcp";
import { MCP_CALL_OPERATION, mcpCallLabel } from "@/lib/sable-mcp-policy";
import type { AiOperation } from "../types";

/**
 * Remote MCP tool calls that need approval. The model never sees this as a
 * tool: the harness turns an APPROVAL-mode call into an `mcp.call` proposal,
 * and approving it runs the call here after re-checking the server's current
 * configuration and the approver's role (lib/sable-mcp.ts).
 */
export const OPERATIONS: AiOperation[] = [
  {
    id: MCP_CALL_OPERATION,
    group: "Integrations",
    kind: "write",
    // The server's own minRole is checked at run time; AGENT is the console floor.
    minRole: "AGENT",
    description: "Run a tool on a remote MCP server.",
    input: z.object({
      serverId: z.string().min(1).max(64),
      server: z.string().min(1).max(64),
      tool: z.string().min(1).max(256),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    label: (a) => mcpCallLabel(String(a.server), String(a.tool)),
    run: (args, ctx) =>
      executeApprovedMcpCall(
        {
          serverId: String(args.serverId),
          server: String(args.server),
          tool: String(args.tool),
          input: args.input as Record<string, unknown>,
        },
        { userId: ctx.userId, role: ctx.role },
      ),
  },
];
