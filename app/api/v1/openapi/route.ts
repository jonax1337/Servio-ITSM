import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approvalDecisionSchema,
  changeCreateSchema,
  changePatchSchema,
  changeTransitionSchema,
  commentCreateSchema,
  problemCreateSchema,
  problemPatchSchema,
  problemTransitionSchema,
} from "@/lib/api-itsm-input";
import { changeImportSchema, problemImportSchema, ticketImportSchema } from "@/lib/api-import-input";

export const runtime = "nodejs";

// Request bodies of the ITSM endpoints come straight from the Zod schemas the
// handlers validate with, so the spec cannot drift from what is accepted.
function body(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return { required: true, content: { "application/json": { schema: json } } };
}
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const pageParams = [
  { name: "page", in: "query", schema: { type: "integer" } },
  { name: "per_page", in: "query", schema: { type: "integer", maximum: 100 } },
];
const q = (name: string, description?: string) => ({ name, in: "query", schema: { type: "string" }, ...(description ? { description } : {}) });
const refused = { "409": { description: "Refused by the workflow rules (message says why)" }, "422": { description: "Validation failed" } };
const agentOnly = "Agent tokens only (AGENT, MANAGER, ADMIN); a USER token gets 403.";

function commentPaths(entity: string) {
  return {
    get: { summary: `List comments of a ${entity}`, parameters: [idParam, ...pageParams], responses: { "200": { description: "Oldest first, paginated" }, "404": { description: "Not found" } } },
    post: { summary: `Add a comment to a ${entity} (internal by default)`, parameters: [idParam], requestBody: body(commentCreateSchema), responses: { "201": { description: "Created" }, "404": { description: "Not found" }, "422": { description: "Validation failed" } } },
  };
}

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Servio API",
    version: "1.0.0",
    description: "Public REST API for Servio ITSM. Authenticate with a Bearer token (Settings › API Tokens).",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Ticket: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ref: { type: "string", example: "INC-0001" },
          title: { type: "string" },
          type: { type: "string", enum: ["INCIDENT", "REQUEST"] },
          status: { type: "string" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        },
      },
      Asset: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/tickets": {
      get: {
        summary: "List tickets",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "priority", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "per_page", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "A paginated list of tickets" } },
      },
      post: {
        summary: "Create a ticket",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
        responses: { "201": { description: "Created" }, "422": { description: "Validation failed" } },
      },
    },
    "/tickets/{id}": {
      get: { summary: "Get a ticket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: { summary: "Update a ticket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Updated" } } },
    },
    "/assets": {
      get: { summary: "List assets", responses: { "200": { description: "OK" } } },
      post: { summary: "Create an asset", responses: { "201": { description: "Created" } } },
    },
    "/assets/{id}": {
      get: { summary: "Get an asset", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
      patch: { summary: "Update an asset", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
    },
    "/services": {
      get: { summary: "List services and their status", responses: { "200": { description: "OK" } } },
    },
    "/tickets/{id}/comments": commentPaths("ticket"),
    "/changes": {
      get: {
        summary: "List changes",
        description: agentOnly,
        parameters: [
          q("status", "A status, or `open` (not closed/rejected/failed/cancelled)"),
          q("type"), q("risk"), q("assignee_id"), q("group_id"), q("category_id"), q("problem_id"),
          q("updated_since", "ISO date/time"),
          q("q", "Substring of title, description, reason, plans, closure notes or comments"),
          ...pageParams,
        ],
        responses: { "200": { description: "A paginated list of changes" } },
      },
      post: { summary: "Create a change (in DRAFT)", description: agentOnly, requestBody: body(changeCreateSchema), responses: { "201": { description: "Created" }, ...refused } },
    },
    "/changes/{id}": {
      get: { summary: "Get a change (with approvals and affected CIs)", parameters: [idParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Edit a change",
        description: "Each field goes through the console action that owns it. Status is not editable here (see /transitions). Applied in order; on a refusal earlier edits stay and `details.applied` lists them.",
        parameters: [idParam],
        requestBody: body(changePatchSchema),
        responses: { "200": { description: "Updated" }, "404": { description: "Not found" }, ...refused },
      },
    },
    "/changes/{id}/transitions": {
      post: {
        summary: "Move a change along its lifecycle",
        description: "`APPROVAL` submits for approval (CAB seated, freeze windows checked). `APPROVED`/`REJECTED` are set by approvals only. `CLOSED`/`FAILED` need an `outcome`, `CANCELLED` a `cancel_reason`.",
        parameters: [idParam],
        requestBody: body(changeTransitionSchema),
        responses: { "200": { description: "Moved" }, "404": { description: "Not found" }, ...refused },
      },
    },
    "/changes/{id}/approvals/{approval_id}": {
      post: {
        summary: "Record a CAB decision",
        description: "Only the seated approver (or an admin), never on a change they requested or own.",
        parameters: [idParam, { name: "approval_id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: body(approvalDecisionSchema),
        responses: { "200": { description: "Decided" }, "403": { description: "Not this approver's seat" }, "404": { description: "Not found" }, ...refused },
      },
    },
    "/changes/{id}/comments": commentPaths("change"),
    "/problems": {
      get: {
        summary: "List problems",
        description: agentOnly,
        parameters: [
          q("status", "A status, or `open` (not resolved/closed)"),
          q("priority"), q("assignee_id"), q("group_id"), q("category_id"),
          q("updated_since", "ISO date/time"),
          q("q", "Substring of title, description, root cause, workaround or comments"),
          ...pageParams,
        ],
        responses: { "200": { description: "A paginated list of problems" } },
      },
      post: { summary: "Create a problem", description: agentOnly, requestBody: body(problemCreateSchema), responses: { "201": { description: "Created" }, ...refused } },
    },
    "/problems/{id}": {
      get: { summary: "Get a problem (with linked tickets and changes)", parameters: [idParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: { summary: "Edit a problem", parameters: [idParam], requestBody: body(problemPatchSchema), responses: { "200": { description: "Updated" }, "404": { description: "Not found" }, ...refused } },
    },
    "/problems/{id}/transitions": {
      post: { summary: "Move a problem along its lifecycle", parameters: [idParam], requestBody: body(problemTransitionSchema), responses: { "200": { description: "Moved" }, "404": { description: "Not found" }, ...refused } },
    },
    "/problems/{id}/comments": commentPaths("problem"),
    "/categories": { get: { summary: "List categories", description: agentOnly, parameters: [q("include_archived", "true to include archived")], responses: { "200": { description: "OK" } } } },
    "/groups": { get: { summary: "List groups with member ids", description: agentOnly, responses: { "200": { description: "OK" } } } },
    ...Object.fromEntries(
      ([["tickets", ticketImportSchema], ["problems", problemImportSchema], ["changes", changeImportSchema]] as const).map(([path, schema]) => [
        `/import/${path}`,
        {
          post: {
            summary: `Import a historical ${path.slice(0, -1)} with its thread`,
            description: "Needs the `admin` scope and an ADMIN owner. Bypasses the lifecycle on purpose; `import_ref` makes re-runs idempotent (200, meta.created false).",
            requestBody: body(schema),
            responses: { "201": { description: "Imported" }, "200": { description: "Already imported (import_ref exists)" }, "403": { description: "Not an admin token" }, "422": { description: "Validation failed or unknown ids" } },
          },
        },
      ]),
    ),
    "/users": { get: { summary: "Look up users (minimal fields)", description: agentOnly, parameters: [q("q", "Name or email"), q("role"), q("active", "true (default), false or all"), ...pageParams], responses: { "200": { description: "OK" } } } },
  },
};

export function GET() {
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
