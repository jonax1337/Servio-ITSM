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
import { recurringTicketCreateSchema, recurringTicketPatchSchema } from "@/lib/recurring-ticket-input";
import {
  assetCreateSchema, assetPatchSchema, assetUpsertSchema, licenseAssignSchema, licenseCreateSchema,
  licensePatchSchema, relationCreateSchema, vendorCreateSchema, vendorPatchSchema,
} from "@/lib/api-asset-input";

export const runtime = "nodejs";

// Request bodies of the ITSM endpoints come straight from the Zod schemas the
// handlers validate with, so the spec cannot drift from what is accepted.
function body(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return { required: true, content: { "application/json": { schema: json } } };
}
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const strId = { name: "id", in: "path", required: true, schema: { type: "string" } };
const refParam = { name: "ref", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$" } };
const pageParams = [
  { name: "page", in: "query", schema: { type: "integer" } },
  { name: "per_page", in: "query", schema: { type: "integer", maximum: 100 } },
];
const q = (name: string, description?: string) => ({ name, in: "query", schema: { type: "string" }, ...(description ? { description } : {}) });
const refused = { "409": { description: "Refused by the workflow rules (message says why)" }, "422": { description: "Validation failed" } };
const agentOnly = "Agent tokens only (AGENT, MANAGER, ADMIN); a USER token gets 403.";

// Attachments: multipart bodies and binary downloads, described by hand.
const ATTACHMENT_PARENTS = [
  ["tickets", "ticket", idParam, "Agents: all tickets, writes where they may act on the ticket. USER tokens: own tickets only (others 404), no files of internal notes."],
  ["changes", "change", idParam, agentOnly],
  ["problems", "problem", idParam, agentOnly],
  ["assets", "asset", strId, agentOnly],
  ["licenses", "license", strId, `${agentOnly} Uploads and deletes need MANAGER+.`],
] as const;
const attachmentIdParam = { name: "attachment_id", in: "path", required: true, schema: { type: "string" } };
const uploadBody = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: ["file"],
        additionalProperties: false,
        properties: {
          file: { type: "string", format: "binary", description: "One file. Size cap MAX_UPLOAD_MB; type, extension and content checked against the allow-list." },
          comment_id: { type: "string", description: "Tickets only: attach to this comment of the ticket (USER tokens: their own public reply)." },
          created_at: { type: "string", format: "date-time", description: "History import: original upload time (ISO with offset). Needs the admin scope and an ADMIN owner." },
          uploaded_by_id: { type: "string", description: "History import: the original uploader (an existing user id). Needs the admin scope and an ADMIN owner." },
        },
      },
    },
  },
};
const attachmentRef = { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Attachment" } } } } };

function attachmentPaths(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const [path, entity, param, access] of ATTACHMENT_PARENTS) {
    paths[`/${path}/{id}/attachments`] = {
      get: {
        summary: `List the files of a ${entity}`,
        description: access,
        parameters: [param, ...pageParams],
        responses: { "200": { description: "Oldest first, paginated (data: Attachment[])" }, "404": { description: "Not found" } },
      },
      post: {
        summary: `Upload a file to a ${entity}`,
        description: `${access} Strict form: unknown parts are a 422.`,
        parameters: [param],
        requestBody: uploadBody,
        responses: {
          "201": { description: "Stored", content: attachmentRef },
          "403": { description: "Not allowed to write here, or history fields without an admin token" },
          "404": { description: "Not found" },
          "409": { description: "Ticket closed or cancelled" },
          "413": { description: "Larger than MAX_UPLOAD_MB" },
          "415": { description: "Not multipart, or the file type is not allowed" },
          "422": { description: "No or empty file, unknown part, bad comment_id / created_at / uploaded_by_id" },
          "429": { description: "Upload rate limit (USER tokens)" },
        },
      },
    };
    paths[`/${path}/{id}/attachments/{attachment_id}`] = {
      get: {
        summary: `Download a file of a ${entity}`,
        description: "The stored bytes, with the stored Content-Type and Content-Disposition: attachment (RFC 5987 filename*).",
        parameters: [param, attachmentIdParam],
        responses: { "200": { description: "The file", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }, "404": { description: "Not found, or not a file of this record" } },
      },
      delete: {
        summary: `Remove a file of a ${entity} (and its stored blob)`,
        parameters: [param, attachmentIdParam],
        responses: { "200": { description: "Removed" }, "403": { description: "Not allowed to write here" }, "404": { description: "Not found, or not a file of this record" } },
      },
    };
  }
  return paths;
}

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
      Attachment: {
        type: "object",
        properties: {
          id: { type: "string" },
          filename: { type: "string" },
          content_type: { type: "string" },
          size: { type: "number", description: "Bytes" },
          comment_id: { type: ["string", "null"] },
          uploaded_by: { type: ["object", "null"], properties: { id: { type: "string" }, name: { type: ["string", "null"] }, email: { type: "string" } } },
          created_at: { type: "string", format: "date-time" },
          download_url: { type: "string" },
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
      get: {
        summary: "List assets",
        parameters: [q("type"), q("status"), q("q", "Substring of name, tag or serial"), q("serial"), q("asset_tag"), q("ip_address"), q("mac_address"), q("import_ref"), q("owner_id"), q("group_id"), q("updated_since", "ISO date/time"), ...pageParams],
        responses: { "200": { description: "OK" } },
      },
      post: { summary: "Create an asset", requestBody: body(assetCreateSchema), responses: { "201": { description: "Created" }, "409": { description: "Asset tag or import ref already used" }, "422": { description: "Validation failed or unknown ids" } } },
    },
    "/assets/{id}": {
      get: { summary: "Get an asset", parameters: [strId], responses: { "200": { description: "OK" } } },
      patch: { summary: "Update any asset field (meta.changed lists what changed)", parameters: [strId], requestBody: body(assetPatchSchema), responses: { "200": { description: "Updated" }, "409": { description: "Unique value taken" }, "422": { description: "Validation failed" } } },
    },
    "/assets/ref/{ref}": {
      get: { summary: "Get an asset by origin reference", parameters: [refParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      put: {
        summary: "Upsert an asset by origin reference (for syncs)",
        description: "Creates the asset (201, name required) or writes only the fields sent (200). Unchanged facts write nothing and no audit row. Strict body.",
        parameters: [refParam],
        requestBody: body(assetUpsertSchema),
        responses: { "201": { description: "Created" }, "200": { description: "Updated or unchanged (meta.changed)" }, "409": { description: "Unique value taken" }, "422": { description: "Validation failed" } },
      },
    },
    "/assets/{id}/relations": {
      get: { summary: "List an asset's dependency edges (both directions)", parameters: [strId], responses: { "200": { description: "OK" } } },
      post: { summary: "Add a dependency edge", parameters: [strId], requestBody: body(relationCreateSchema), responses: { "201": { description: "Added (idempotent)" }, ...refused } },
    },
    "/assets/{id}/relations/{relation_id}": {
      delete: { summary: "Remove a dependency edge", parameters: [strId, { name: "relation_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Removed" }, "404": { description: "Not an edge of this asset" } } },
    },
    "/vendors": {
      get: { summary: "List vendors", parameters: [q("name"), q("q"), q("active"), ...pageParams], responses: { "200": { description: "OK" } } },
      post: { summary: "Create a vendor (MANAGER+)", requestBody: body(vendorCreateSchema), responses: { "201": { description: "Created" }, "403": { description: "Not a manager" }, "409": { description: "Name taken" } } },
    },
    "/vendors/{id}": {
      get: { summary: "Get a vendor", parameters: [strId], responses: { "200": { description: "OK" } } },
      patch: { summary: "Edit a vendor (MANAGER+)", parameters: [strId], requestBody: body(vendorPatchSchema), responses: { "200": { description: "Updated" }, ...refused } },
    },
    "/licenses": {
      get: { summary: "List licenses with seat usage", parameters: [q("vendor_id"), q("q"), q("asset_id"), q("user_id"), ...pageParams], responses: { "200": { description: "OK" } } },
      post: { summary: "Create a license (MANAGER+)", requestBody: body(licenseCreateSchema), responses: { "201": { description: "Created" }, ...refused } },
    },
    "/licenses/{id}": {
      get: { summary: "Get a license", parameters: [strId], responses: { "200": { description: "OK" } } },
      patch: { summary: "Edit a license (MANAGER+)", parameters: [strId], requestBody: body(licensePatchSchema), responses: { "200": { description: "Updated" }, ...refused } },
    },
    "/licenses/{id}/assignments": {
      post: { summary: "Assign a seat (MANAGER+)", parameters: [strId], requestBody: body(licenseAssignSchema), responses: { "201": { description: "Assigned" }, ...refused } },
    },
    "/licenses/{id}/assignments/{assignment_id}": {
      delete: { summary: "Release a seat (MANAGER+)", parameters: [strId, { name: "assignment_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Released" }, "404": { description: "Not an assignment of this license" } } },
    },
    "/services": {
      get: { summary: "List services and their status", responses: { "200": { description: "OK" } } },
    },
    "/tickets/{id}/comments": commentPaths("ticket"),
    "/recurring-tickets": {
      get: { summary: "List recurring ticket schedules", description: agentOnly, parameters: [q("active", "true, false or all (default)"), q("q", "Name or title"), q("import_ref"), ...pageParams], responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a recurring ticket schedule (MANAGER+)",
        description: "`first_due_at` is wall-clock time in `timezone` (YYYY-MM-DDTHH:mm) or an ISO time with offset. With `import_ref`, a re-run for an existing schedule changes nothing (200, meta.created false).",
        requestBody: body(recurringTicketCreateSchema),
        responses: { "201": { description: "Created" }, "200": { description: "Already imported (import_ref exists)" }, "403": { description: "Not a manager" }, ...refused },
      },
    },
    "/recurring-tickets/{id}": {
      get: { summary: "Get a recurring ticket schedule", parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: { summary: "Edit, pause or resume a schedule (MANAGER+)", parameters: [strId], requestBody: body(recurringTicketPatchSchema), responses: { "200": { description: "Updated" }, "403": { description: "Not a manager" }, "404": { description: "Not found" }, ...refused } },
      delete: { summary: "Delete a schedule (MANAGER+); its tickets stay", parameters: [strId], responses: { "200": { description: "Deleted" }, "403": { description: "Not a manager" }, "404": { description: "Not found" } } },
    },
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
    ...attachmentPaths(),
    "/users": { get: { summary: "Look up users (minimal fields)", description: agentOnly, parameters: [q("q", "Name or email"), q("role"), q("active", "true (default), false or all"), ...pageParams], responses: { "200": { description: "OK" } } } },
  },
};

export function GET() {
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
