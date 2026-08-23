import { tool } from "ai";
import type { ToolSet } from "ai";
import { hasRole, type Role } from "@/lib/session";
import type { AiOperation, AiOpCtx, AiOpChatScope, AiOpResult } from "./types";
import { ALL_OPERATIONS, findOperation } from "./registry";
import { filterOperationsForRole } from "./availability";

const NON_TOOL = /[^a-zA-Z0-9_]/g;
const readName = (op: AiOperation) => op.id.replace(NON_TOOL, "_");
const writeName = (op: AiOperation) => "propose_" + op.id.replace(NON_TOOL, "_");

/**
 * Operations the acting role may use on the given chat surface. `adminOnly` ops
 * are gated by the acting user's role alone — see lib/ai-operations/availability.ts.
 */
export function availableOperations(role: Role, scope: AiOpChatScope): AiOperation[] {
  return filterOperationsForRole(ALL_OPERATIONS, role, scope);
}

/**
 * Build the ai-sdk tools for every operation the acting user may use: READ ops
 * execute immediately; WRITE ops only PROPOSE (validated preview) — the returned
 * `writeToolToOpId` map lets the caller turn those tool calls into approval cards.
 */
export function buildOperationTools(
  ctx: AiOpCtx,
  scope: AiOpChatScope,
): { tools: ToolSet; writeToolToOpId: Map<string, string> } {
  const tools: ToolSet = {};
  const writeToolToOpId = new Map<string, string>();

  for (const op of availableOperations(ctx.role, scope)) {
    if (op.kind === "read") {
      tools[readName(op)] = tool({
        description: op.description,
        inputSchema: op.input,
        execute: async (args) => {
          const res = await op.run(args as Record<string, unknown>, ctx);
          return res.ok ? (res.data ?? { ok: true, summary: res.summary }) : { ok: false, error: res.error };
        },
      });
    } else {
      const name = writeName(op);
      writeToolToOpId.set(name, op.id);
      tools[name] = tool({
        description:
          op.description +
          " NOTE: this only PROPOSES the change for the user to approve — nothing is applied until they click Approve.",
        inputSchema: op.input,
        execute: async (args) => {
          const parsed = op.input.safeParse(args);
          if (!parsed.success) {
            return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
          }
          const data = parsed.data as Record<string, unknown>;
          // Return the full proposal as the tool result so the client tool-UI
          // can render an approval card directly (no mutation happens here).
          return {
            ok: true,
            proposal: {
              id: op.id,
              operationId: op.id,
              args: data,
              label: op.label ? op.label(data) : op.id,
            },
          };
        },
      });
    }
  }
  return { tools, writeToolToOpId };
}

/**
 * Apply a generic operation proposal: re-look-up the op, re-check RBAC,
 * re-validate the args (never trust the client), then run the real mutation.
 */
export async function runOperation(input: {
  operationId: string;
  args: unknown;
  ctx: AiOpCtx;
  scope: AiOpChatScope;
}): Promise<AiOpResult> {
  const op = findOperation(input.operationId);
  if (!op) return { ok: false, error: "Unknown operation." };
  // adminOnly ops require the ADMIN role (minRole) — the acting ctx.role is the
  // fresh DB role re-resolved by applyAssistantProposal, not the JWT claim.
  if (!hasRole(input.ctx.role, op.minRole)) return { ok: false, error: "Not authorised." };
  const parsed = op.input.safeParse(input.args);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return op.run(parsed.data as Record<string, unknown>, input.ctx);
}
