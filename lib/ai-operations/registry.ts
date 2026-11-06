import type { AiOperation } from "./types";
import { OPERATIONS as ticketOps } from "./modules/tickets";
import { OPERATIONS as taxonomyOps } from "./modules/taxonomy";
import { OPERATIONS as orgOps } from "./modules/org";
import { OPERATIONS as catalogOps } from "./modules/catalog-services";
import { OPERATIONS as cmdbOps } from "./modules/cmdb";
import { OPERATIONS as configOps } from "./modules/config";
import { OPERATIONS as knowledgeOps } from "./modules/knowledge";
import { OPERATIONS as pcOps } from "./modules/problems-changes";
import { OPERATIONS as projectOps } from "./modules/projects";
import { OPERATIONS as mcpOps } from "./modules/mcp";
import { OPERATIONS as changeScheduleOps } from "./modules/change-schedule";
import { OPERATIONS as oncallOps } from "./modules/oncall";
import { OPERATIONS as statusOps } from "./modules/status";
import { OPERATIONS as releaseOps } from "./modules/releases";
import { OPERATIONS as contractOps } from "./modules/contracts";
import { OPERATIONS as insightOps } from "./modules/insights";

/** Every RBAC-gated operation Sable can perform, composed from the domain modules. */
export const ALL_OPERATIONS: AiOperation[] = [
  ...ticketOps,
  ...taxonomyOps,
  ...orgOps,
  ...catalogOps,
  ...cmdbOps,
  ...configOps,
  ...knowledgeOps,
  ...pcOps,
  ...projectOps,
  ...changeScheduleOps,
  ...oncallOps,
  ...statusOps,
  ...releaseOps,
  ...contractOps,
  ...insightOps,
];

/**
 * Operations reachable only through a proposal the harness builds (never offered
 * to the model as a tool): approved remote MCP calls.
 */
const PROPOSAL_ONLY_OPERATIONS: AiOperation[] = [...mcpOps];

const BY_ID = new Map([...ALL_OPERATIONS, ...PROPOSAL_ONLY_OPERATIONS].map((o) => [o.id, o]));

export function findOperation(id: string): AiOperation | undefined {
  return BY_ID.get(id);
}
