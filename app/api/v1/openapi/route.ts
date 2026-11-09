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
import {
  changeImportSchema, changeReimportSchema, problemImportSchema, problemReimportSchema, ticketImportSchema, ticketReimportSchema,
} from "@/lib/api-import-input";
import { ticketCreateSchema, ticketResolveSchema } from "@/lib/api-ticket-input";
import { categoryCreateSchema, categoryPatchSchema } from "@/lib/api-category-input";
import { groupMemberAddSchema } from "@/lib/api-group-input";
import { serviceCreateSchema, servicePatchSchema, serviceUpsertSchema } from "@/lib/api-service-input";
import { articleCreateSchema, articlePatchSchema, articleTransitionSchema, articleUpsertSchema } from "@/lib/api-article-input";
import { recurringTicketCreateSchema, recurringTicketPatchSchema } from "@/lib/recurring-ticket-input";
import { userPatchSchema } from "@/lib/api-user-input";
import {
  assetCreateSchema, assetPatchSchema, assetUpsertSchema, licenseAssignSchema, licenseCreateSchema,
  licensePatchSchema, relationCreateSchema, vendorCreateSchema, vendorPatchSchema, vendorUpsertSchema,
} from "@/lib/api-asset-input";
import { LEGACY_SCOPES, RESOURCE_SCOPES, requiredScope, scopesGranting } from "@/lib/api-scopes";
import { catalogItemCreateSchema, catalogItemPatchSchema, catalogItemUpsertSchema } from "@/lib/api-catalog-input";
import { changeTemplateCreateSchema, changeTemplatePatchSchema, changeTemplateUpsertSchema } from "@/lib/api-change-template-input";
import { contractCreateSchema, contractPatchSchema, contractUpsertSchema } from "@/lib/api-contract-input";

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
const managerWrites = `${agentOnly} Writes need a token owned by a MANAGER or ADMIN (403 otherwise), as in the console.`;

/**
 * The configuration resources MANAGER+ maintain (catalog items, change templates,
 * contracts, vendors): list + create, get/patch/delete by id, get/upsert by origin
 * reference. `meta.changed` names the fields a write changed; an unchanged write
 * stores nothing and no audit row.
 */
function managedPaths(
  path: string,
  noun: string,
  schemas: { create: z.ZodType; patch: z.ZodType; upsert: z.ZodType },
  opts: { filters: object[]; createNote: string; upsertNote: string; deleteNote: string },
) {
  const conflict = { "409": { description: "A unique value (import_ref, or the name where names are unique) is already used; the existing id is in details" } };
  return {
    [`/${path}`]: {
      get: { summary: `List ${noun}s`, description: agentOnly, parameters: [...opts.filters, ...pageParams], responses: { "200": { description: "OK (paginated)" } } },
      post: {
        summary: `Create a ${noun} (MANAGER+)`,
        description: `${managerWrites} ${opts.createNote}`,
        requestBody: body(schemas.create),
        responses: { "201": { description: "Created" }, "403": { description: "Not a manager" }, ...conflict, "422": { description: "Validation failed or unknown ids" } },
      },
    },
    [`/${path}/{id}`]: {
      get: { summary: `Get a ${noun}`, description: agentOnly, parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: `Edit a ${noun} (MANAGER+)`,
        description: "Fields left out keep their value; `null` clears a nullable one. `meta.changed` lists what changed.",
        parameters: [strId],
        requestBody: body(schemas.patch),
        responses: { "200": { description: "Updated or unchanged (meta.changed)" }, "403": { description: "Not a manager" }, "404": { description: "Not found" }, ...conflict, "422": { description: "Validation failed or unknown ids" } },
      },
      delete: {
        summary: `Delete a ${noun} (MANAGER+)`,
        description: opts.deleteNote,
        parameters: [strId],
        responses: { "200": { description: "Deleted ({ id, deleted: true })" }, "403": { description: "Not a manager" }, "404": { description: "Not found" } },
      },
    },
    [`/${path}/ref/{ref}`]: {
      get: { summary: `Get a ${noun} by origin reference`, description: agentOnly, parameters: [refParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      put: {
        summary: `Create or update a ${noun} by origin reference (MANAGER+)`,
        description: `${opts.upsertNote} Strict body; unchanged fields write nothing and no audit row. \`meta.created\` and \`meta.changed\` say what happened.`,
        parameters: [refParam],
        requestBody: body(schemas.upsert),
        responses: { "201": { description: "Created" }, "200": { description: "Updated or unchanged (meta.changed)" }, "403": { description: "Not a manager" }, ...conflict, "422": { description: "Validation failed, unknown ids, or required fields missing for a new record" } },
      },
    },
  };
}

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
          file: { type: "string", format: "binary", description: "One file. Size cap MAX_UPLOAD_MB; type, extension and content checked against the allow-list (plus the admin-added extensions of Settings › Uploads, stored as application/octet-stream; executables and scripts are never accepted)." },
          comment_id: { type: "string", description: "Tickets only: attach to this comment of the ticket (USER tokens: their own public reply)." },
          created_at: { type: "string", format: "date-time", description: "History import: original upload time (ISO with offset). Needs the import:write scope and an ADMIN owner." },
          uploaded_by_id: { type: "string", description: "History import: the original uploader (an existing user id). Needs the import:write scope and an ADMIN owner." },
          import_ref: {
            type: "string",
            maxLength: 200,
            description: "History import: the file's source id (unique). A re-upload with a ref already on this record returns that file (200, meta.created false) instead of storing a copy; a ref used on another record is a 409. Needs the import:write scope and an ADMIN owner.",
          },
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
          "201": { description: "Stored (with import_ref: meta.created true)", content: attachmentRef },
          "200": { description: "import_ref already stored on this record: that file, meta.created false", content: attachmentRef },
          "403": { description: "Not allowed to write here, or history fields without import:write and an ADMIN owner" },
          "404": { description: "Not found" },
          "409": { description: "Ticket closed or cancelled, or import_ref already used on another record" },
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

const METHODS = ["get", "put", "post", "patch", "delete"] as const;

/**
 * Annotate every operation with the scopes that satisfy it, from the same rule
 * the handlers are held to (lib/api-scopes.ts requiredScope; enforced per route
 * by tests/unit/api-route-scopes.test.ts). OpenAPI 3.1 allows role names in the
 * requirement of a non-OAuth scheme; alternatives are separate requirements.
 */
function withScopes(paths: Record<string, Record<string, Record<string, unknown>>>) {
  for (const [path, ops] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = ops[method];
      const scope = op ? requiredScope(path, method) : null;
      if (!op || !scope) continue;
      op["x-required-scope"] = scope;
      op.security = scopesGranting(scope).map((s) => ({ bearerAuth: [s] }));
    }
  }
  return paths;
}

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Servio API",
    version: "1.0.0",
    description:
      "Public REST API for Servio ITSM. Authenticate with a Bearer token (Settings › API Tokens).\n\n" +
      "Every operation lists the token scopes that satisfy it in `security` (any one is enough) and the resource scope it needs in `x-required-scope`. " +
      "Resource scopes (`tickets:write`, `cmdb:read`, …) grant one resource; a resource write includes its read. " +
      "The legacy scopes keep their meaning: `read` grants every read, `write` every write except `import:write` and `kb:publish`, `admin` everything.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: `Personal access token. Scopes: ${[...LEGACY_SCOPES, ...RESOURCE_SCOPES].join(", ")}.`,
      },
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
          external_ref: { type: ["string", "null"], description: "Integration key (monitoring dedup); kept after resolution" },
          external_ref_open: { type: "boolean", description: "This is the open ticket new POSTs with the key land in" },
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
          import_ref: { type: ["string", "null"], description: "Source id of an imported file" },
          uploaded_by: { type: ["object", "null"], properties: { id: { type: "string" }, name: { type: ["string", "null"] }, email: { type: "string" } } },
          created_at: { type: "string", format: "date-time" },
          download_url: { type: "string" },
        },
      },
    },
  },
  paths: withScopes({
    "/tickets": {
      get: {
        summary: "List tickets",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "priority", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          q("import_ref"),
          q("external_ref", "Every ticket that carried this key, open or resolved"),
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "per_page", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "A paginated list of tickets" } },
      },
      post: {
        summary: "Create a ticket (or land in the open one carrying `external_ref`)",
        description: "Keys are camelCase or snake_case. With `external_ref` (agent tokens only) at most one OPEN ticket carries the key: a repeat answers 200 with that ticket and `meta.deduplicated: true` (with `on_duplicate: \"comment\"` the description is added as an internal note), concurrent repeats included. After the ticket is resolved/closed/cancelled the next POST opens a new one. `group_id` (agent tokens) routes the ticket; without it the category's team becomes the group. An assignee must be a member of the group; without one, the group's auto-assign strategy picks an agent.",
        requestBody: body(ticketCreateSchema),
        responses: {
          "201": { description: "Created" },
          "200": { description: "Deduplicated: the open ticket with this external_ref (meta.deduplicated, meta.comment)" },
          "403": { description: "external_ref on a non-agent token, or the dedup comment was refused (ticket in details)" },
          "422": { description: "Validation failed" },
        },
      },
    },
    "/tickets/{id}": {
      get: { summary: "Get a ticket", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Update a ticket",
        description: "Agent tokens. Fields: `title`, `description`, `status`, `priority`, `assignee_id`, `group_id`, `service_id`, `problem_id`, `change_id` (null clears). A new `group_id` clears an assignee who is not a member and runs the group's auto-assign. A new `service_id` (or `priority`) re-prices the SLA deadlines of an open ticket; an unknown service is a 422.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Updated" }, ...refused },
      },
    },
    "/tickets/ref/{ref}": {
      get: { summary: "Get the ticket carrying an external reference (the open one, else the most recent)", parameters: [refParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
    },
    "/tickets/ref/{ref}/resolve": {
      post: {
        summary: "Resolve the open ticket carrying an external reference (monitoring recovery)",
        description: `${agentOnly} Runs the console's resolution action: workflow map, SLA stamping, resolution comment and mail. Body optional; the note is internal unless \`internal: false\`.`,
        parameters: [refParam],
        requestBody: { ...body(ticketResolveSchema), required: false },
        responses: { "200": { description: "Resolved" }, "403": { description: "Not an agent token, or may not act on the ticket" }, "404": { description: "No open ticket carries the ref" }, ...refused },
      },
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
    "/assets/{id}/services": {
      get: {
        summary: "Services an outage of this asset hits (direct and transitive)",
        description: `${agentOnly} \`direct\` = runs on the asset; the others run on assets it takes down or depend on an affected service. Links are managed through \`asset_ids\` of the service.`,
        parameters: [strId],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
    },
    "/assets/{id}/relations": {
      get: { summary: "List an asset's dependency edges (both directions)", parameters: [strId], responses: { "200": { description: "OK" } } },
      post: { summary: "Add a dependency edge", parameters: [strId], requestBody: body(relationCreateSchema), responses: { "201": { description: "Added (idempotent)" }, ...refused } },
    },
    "/assets/{id}/relations/{relation_id}": {
      delete: { summary: "Remove a dependency edge", parameters: [strId, { name: "relation_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Removed" }, "404": { description: "Not an edge of this asset" } } },
    },
    ...managedPaths("vendors", "vendor", { create: vendorCreateSchema, patch: vendorPatchSchema, upsert: vendorUpsertSchema }, {
      filters: [q("name", "Exact name"), q("q", "Substring of the name"), q("active", "true, false or all (default)")],
      createNote: "Names are unique.",
      upsertNote: "Creates the vendor (201; `name` required) when the reference is new, otherwise writes only the fields sent (200). A name another vendor has is a 409 with its id.",
      deleteNote: "Its contracts and licenses stay, without a vendor.",
    }),
    ...managedPaths("contracts", "contract", { create: contractCreateSchema, patch: contractPatchSchema, upsert: contractUpsertSchema }, {
      filters: [
        q("q", "Substring of name or number"), q("vendor_id"), q("owner_id"), q("status"), q("type"),
        q("asset_id", "Contracts covering this asset"), q("ends_before", "YYYY-MM-DD: end date before that day"),
      ],
      createNote: "Vendor, owner and assets must exist; the end date may not be before the start date. `asset_ids` sets the covered assets. Responses carry `expiry` (NONE | OK | EXPIRING | EXPIRED).",
      upsertNote: "Creates the contract (201; `name` and `start_date` required) when the reference is new, otherwise writes only the fields sent (200); `asset_ids` replaces the covered assets.",
      deleteNote: "Licenses under it stay, without a contract; covered assets lose the link.",
    }),
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
    "/articles": {
      get: {
        summary: "List knowledge articles (without bodies)",
        description: agentOnly,
        parameters: [q("status"), q("visibility"), q("category_id"), q("import_ref"), q("updated_since", "ISO date/time"), q("q", "Title or excerpt"), ...pageParams],
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Create an article (always DRAFT)",
        description: `${agentOnly} \`body\` is Markdown unless \`body_format: "html"\`; stored as sanitised HTML.`,
        requestBody: body(articleCreateSchema),
        responses: { "201": { description: "Created" }, "409": { description: "import_ref already in use (id in details)" }, "422": { description: "Validation failed" } },
      },
    },
    "/articles/{id}": {
      get: { summary: "Get an article", parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Edit an article (new revision; a published article edited below MANAGER goes back to review)",
        parameters: [strId],
        requestBody: body(articlePatchSchema),
        responses: { "200": { description: "Updated" }, "404": { description: "Not found" }, "409": { description: "Concurrent edit, retry" }, "422": { description: "Validation failed" } },
      },
      delete: { summary: "Delete an article", parameters: [strId], responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } } },
    },
    "/articles/{id}/transitions": {
      post: {
        summary: "Move an article along its lifecycle",
        description: "Publishing needs a MANAGER+ token owner who is not the author.",
        parameters: [strId],
        requestBody: body(articleTransitionSchema),
        responses: { "200": { description: "Moved" }, "403": { description: "Publishing not allowed for this token owner" }, "404": { description: "Not found" }, ...refused },
      },
    },
    "/articles/ref/{ref}": {
      get: { summary: "Get the article with this origin reference", parameters: [refParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      put: {
        summary: "Upsert an article by origin reference (idempotent)",
        description: "Creates the article (201) or writes the fields that differ as one revision (200); the same content again changes nothing (`meta.changed` empty). `status` skips the review and needs the kb:publish scope and an ADMIN owner.",
        parameters: [refParam],
        requestBody: body(articleUpsertSchema),
        responses: { "200": { description: "Updated or unchanged" }, "201": { description: "Created" }, "403": { description: "status without kb:publish scope/ADMIN owner" }, "422": { description: "Validation failed" } },
      },
    },
    "/services": {
      get: {
        summary: "List services (not paginated)",
        description: `${agentOnly} Each with \`code\`, \`import_ref\`, the ids of category, owner, SLA and group, plus the category name and SLA targets.`,
        parameters: [q("status"), q("criticality"), q("code"), q("import_ref"), q("q", "Name or code")],
        responses: { "200": { description: "OK" } },
      },
      post: {
        summary: "Create a service (MANAGER+)",
        description:
          "`asset_ids` sets the supporting CIs; `depends_on` the services it needs, each by `service_id` or `service_ref` (an import_ref) with an optional `note`. " +
          "A self-dependency or a cycle is a 422 with `details.code` `self_dependency` / `dependency_cycle` (and `details.cycle`). Strict body.",
        requestBody: body(serviceCreateSchema),
        responses: {
          "201": { description: "Created (detail view, meta.changed)" },
          "403": { description: "Not a manager" },
          "409": { description: "Name, code or import_ref already used (`details.code` name_taken / code_taken / import_ref_taken, existing id in details)" },
          "422": { description: "Validation failed, unknown ids/refs (`unknown_reference`), an entry listed twice (`duplicate_entry`)" },
        },
      },
    },
    "/services/{id}": {
      get: { summary: "Get a service with `assets`, `depends_on` and `used_by`", description: agentOnly, parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Update a service (MANAGER+)",
        description: "Only the fields sent change; `asset_ids` and `depends_on` replace their whole set (`[]` clears). `meta.changed` lists what changed; an unchanged body writes nothing.",
        parameters: [strId],
        requestBody: body(servicePatchSchema),
        responses: { "200": { description: "Updated or unchanged" }, "403": { description: "Not a manager" }, "404": { description: "Not found" }, "409": { description: "Name or code already used" }, "422": { description: "Validation failed, unknown ids, self-dependency or cycle" } },
      },
      delete: {
        summary: "Delete a service (MANAGER+)",
        description: "Refused while anything references the service; set `status` to RETIRED instead. Its own CI links and dependencies are removed with it.",
        parameters: [strId],
        responses: { "200": { description: "Deleted" }, "403": { description: "Not a manager" }, "404": { description: "Not found" }, "409": { description: "Still referenced (`details.code` service_in_use, `details.references` counts, `details.suggestion`)" } },
      },
    },
    "/services/{id}/impact": {
      get: {
        summary: "Services that go down with this one (transitive dependants, nearest first)",
        description: `${agentOnly} Each entry: \`service_id\`, \`code\`, \`name\`, \`status\`, \`criticality\`, \`depth\` (1 = depends on it directly), \`via\`.`,
        parameters: [strId],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
    },
    "/services/ref/{ref}": {
      get: { summary: "Get the service with this origin reference", description: agentOnly, parameters: [refParam], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      put: {
        summary: "Upsert a service by origin reference (MANAGER+, idempotent)",
        description:
          "Creates the service (201, `name` required) or writes only the fields sent (200). The same facts again write nothing and no audit row (`meta.changed` empty). " +
          "`depends_on` may name other services by `service_ref`, so a whole service map can be pushed in dependency order.",
        parameters: [refParam],
        requestBody: body(serviceUpsertSchema),
        responses: { "201": { description: "Created" }, "200": { description: "Updated or unchanged (meta.changed)" }, "403": { description: "Not a manager" }, "409": { description: "Name or code already used" }, "422": { description: "Validation failed, unknown ids/refs, self-dependency or cycle" } },
      },
    },
    "/health": {
      get: {
        summary: "Liveness and the running version",
        description:
          "Public and reachable during maintenance. `status` is `ok` while the app and its database answer (`unavailable` with 503 otherwise); " +
          "`maintenance` tells whether maintenance mode blocks access. `version` (the running Servio release) is included only for a valid API token of any scope; " +
          "an invalid token gets 401.",
        security: [{}, { bearerAuth: [] }],
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      required: ["status", "maintenance"],
                      properties: {
                        status: { type: "string", enum: ["ok", "unavailable"] },
                        maintenance: { type: "boolean" },
                        version: { type: "string", example: "0.6.0", description: "Only with a valid API token" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "A token was sent and is invalid" },
          "503": { description: "The database does not answer (`status: unavailable`)" },
        },
      },
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
    ...managedPaths("catalog-items", "catalog item", { create: catalogItemCreateSchema, patch: catalogItemPatchSchema, upsert: catalogItemUpsertSchema }, {
      filters: [q("q", "Substring of the name"), q("category_id"), q("service_id"), q("group_id"), q("published", "true or false (default both)")],
      createNote:
        "`questions` is the ordered request form. A question may carry `condition: { field, values }`: it is shown, and only then required, when the earlier select / multiselect / checkbox / urgency question `field` is answered with one of `values` (a checkbox answers \"true\" or \"false\"); hidden answers are not stored. `group_id` routes requests (else the service's team, else the category's). `requires_approval` needs `approver_id` (an active agent) or `approval_stages`.",
      upsertNote: "Creates the item (201; `name` required) when the reference is new, otherwise writes only the fields sent (200); `questions` replaces the whole form.",
      deleteNote: "Requests made from it keep their answers and history.",
    }),
    ...managedPaths("change-templates", "change template", { create: changeTemplateCreateSchema, patch: changeTemplatePatchSchema, upsert: changeTemplateUpsertSchema }, {
      filters: [q("q", "Substring of the name"), q("type", "STANDARD or NORMAL"), q("service_id"), q("active", "true or false (default both)")],
      createNote: "`name`, `title` and `type` are required. A STANDARD template is pre-authorized: changes made from it skip the CAB, so it needs `implementation_plan` and `rollback_plan`, and writing an active one (creating or activating it, or changing its type, risk, impact or plans) needs a token owned by a role that may approve changes of its risk: a manager for LOW and MEDIUM, only an admin for HIGH (else 403). Names are unique.",
      upsertNote: "Creates the template (201; `name`, `title` and `type` required) when the reference is new, otherwise writes only the fields sent (200). The same approval rule as on create applies to STANDARD templates.",
      deleteNote: "Changes created from it stay and lose the link.",
    }),
    "/categories": {
      get: { summary: "List categories", description: `${agentOnly} Categories are shared by tickets, problems, changes, catalog items, change templates and articles (no separate change categories); a change carries one as \`category_id\`.`, parameters: [q("include_archived", "true to include archived")], responses: { "200": { description: "OK" } } },
      post: {
        summary: "Create a category (MANAGER+)",
        description: "`group_id` is the team that handles it (the default group of tickets created through the API); `portal_hidden` keeps it out of the self-service portal.",
        requestBody: body(categoryCreateSchema),
        responses: { "201": { description: "Created" }, "403": { description: "Not a manager" }, "409": { description: "Name already used under the same parent (existing id in details)" }, "422": { description: "Validation failed" } },
      },
    },
    "/categories/{id}": {
      get: { summary: "Get a category", description: agentOnly, parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Update a category (MANAGER+)",
        parameters: [strId],
        requestBody: body(categoryPatchSchema),
        responses: { "200": { description: "Updated" }, "403": { description: "Not a manager" }, "404": { description: "Not found" }, "409": { description: "Name already used under the same parent" }, "422": { description: "Validation failed" } },
      },
    },
    "/groups": { get: { summary: "List groups with member ids", description: agentOnly, responses: { "200": { description: "OK" } } } },
    "/groups/{id}": {
      get: { summary: "Get a group with its members", description: agentOnly, parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
    },
    "/groups/{id}/members": {
      post: {
        summary: "Add a user to a group (MANAGER+)",
        description:
          "Needs the `directory:write` scope (the legacy `write` works too) and a token owned by a MANAGER or ADMIN. Idempotent: an existing membership answers 200 " +
          "(`meta.created` false) and keeps its role; a new one answers 201. `role` (MEMBER default, or LEAD) applies only to a new membership.",
        parameters: [strId],
        requestBody: body(groupMemberAddSchema),
        responses: { "201": { description: "Added" }, "200": { description: "Already a member" }, "403": { description: "Token owner is not a manager" }, "404": { description: "Group not found" }, "422": { description: "Validation failed or unknown user" } },
      },
    },
    "/groups/{id}/members/{userId}": {
      delete: {
        summary: "Remove a user from a group (MANAGER+)",
        description: "Needs the `directory:write` scope and a token owned by a MANAGER or ADMIN. Idempotent: a user who is not a member answers 200 with `removed` false.",
        parameters: [strId, { name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Removed (or was not a member)" }, "403": { description: "Token owner is not a manager" }, "404": { description: "Group not found" } },
      },
    },
    ...Object.fromEntries(
      ([["tickets", ticketImportSchema], ["problems", problemImportSchema], ["changes", changeImportSchema]] as const).map(([path, schema]) => [
        `/import/${path}`,
        {
          post: {
            summary: `Import a historical ${path.slice(0, -1)} with its thread`,
            description: `Needs the \`import:write\` scope (or \`admin\`) and an ADMIN owner. Bypasses the lifecycle on purpose; \`import_ref\` makes re-runs idempotent (200, meta.created false). To bring an imported record up to date use PUT /import/${path}/{import_ref}.`,
            requestBody: body(schema),
            responses: { "201": { description: "Imported" }, "200": { description: "Already imported (import_ref exists)" }, "403": { description: "Token lacks import:write, or its owner is not an ADMIN" }, "422": { description: "Validation failed or unknown ids" } },
          },
        },
      ]),
    ),
    ...Object.fromEntries(
      ([["tickets", ticketReimportSchema], ["problems", problemReimportSchema], ["changes", changeReimportSchema]] as const).map(([path, schema]) => [
        `/import/${path}/{import_ref}`,
        {
          put: {
            summary: `Create or re-import a historical ${path.slice(0, -1)} by its import_ref (update mode)`,
            description:
              "Needs the `import:write` scope (or `admin`) and an ADMIN owner. Same body as the POST import; `import_ref` comes from the path (in the body only if equal). " +
              "Creates the record when the ref is new, otherwise replaces the imported fields with the given state and appends only the comments the record lacks " +
              "(matched by comment `import_ref`, else by body + created_at). `meta.result` is created | updated | unchanged, `meta.changed` lists the fields, " +
              "`meta.comments_added` counts new comments. Unchanged input writes nothing and no audit row. Only records carrying that importRef are matched.",
            parameters: [{ name: "import_ref", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 200 }, description: "URL-encoded, e.g. glpi%3Achange%3A129" }],
            requestBody: body(schema),
            responses: {
              "201": { description: "Created (meta.result created)" },
              "200": { description: "Updated or unchanged (meta.result, meta.changed, meta.comments_added)" },
              "403": { description: "Token lacks import:write, or its owner is not an ADMIN" },
              "422": { description: "Validation failed, unknown ids, or a body import_ref that differs from the path" },
            },
          },
        },
      ]),
    ),
    ...attachmentPaths(),
    "/users": {
      get: {
        summary: "Look up users (minimal fields)",
        description: `${agentOnly} Each user carries \`secondary_emails\`: extra addresses that inbound mail is matched on (notifications go to \`email\`).`,
        parameters: [q("q", "Name, primary or secondary email"), q("role"), q("active", "true (default), false or all"), ...pageParams],
        responses: { "200": { description: "OK" } },
      },
    },
    "/users/{id}": {
      get: { summary: "Get a user (minimal fields)", description: agentOnly, parameters: [strId], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } },
      patch: {
        summary: "Replace a user's secondary email addresses (ADMIN)",
        description:
          "Needs the `directory:write` scope (the legacy `write` works too) and a token owned by an ADMIN. `secondary_emails` replaces the whole list (`[]` removes all). " +
          "An address must not be the user's own primary address and must not belong to anyone else, as primary or secondary address.",
        parameters: [strId],
        requestBody: body(userPatchSchema),
        responses: {
          "200": { description: "Updated (or unchanged)" },
          "403": { description: "Token owner is not an ADMIN" },
          "404": { description: "Not found" },
          "409": { description: "An address already belongs to another person" },
          "422": { description: "Validation failed (malformed address, the primary address, too many, unknown fields)" },
        },
      },
    },
  }),
};

export function GET() {
  return NextResponse.json(spec, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
