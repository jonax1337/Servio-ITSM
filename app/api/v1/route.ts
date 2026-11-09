import { ok, preflight } from "@/lib/api";
import { LEGACY_SCOPES, RESOURCE_SCOPES } from "@/lib/api-scopes";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return ok({
    name: "Servio API",
    version: "1.0.0",
    documentation: "/api/v1/openapi",
    authentication: "Bearer token — send 'Authorization: Bearer <token>'. Manage tokens under Settings › API Tokens.",
    scopes: {
      resource: RESOURCE_SCOPES,
      legacy: LEGACY_SCOPES,
      note: "Each operation needs one resource scope (see x-required-scope in the OpenAPI spec). A resource write includes its read; 'read' grants every read, 'write' every write except import:write, 'admin' everything.",
    },
    resources: {
      tickets: "/api/v1/tickets",
      ticket: "/api/v1/tickets/{id}",
      ticket_by_ref: "/api/v1/tickets/ref/{ref}",
      ticket_resolve_by_ref: "/api/v1/tickets/ref/{ref}/resolve",
      assets: "/api/v1/assets",
      asset: "/api/v1/assets/{id}",
      asset_by_ref: "/api/v1/assets/ref/{ref}",
      asset_relations: "/api/v1/assets/{id}/relations",
      vendors: "/api/v1/vendors",
      licenses: "/api/v1/licenses",
      license_assignments: "/api/v1/licenses/{id}/assignments",
      services: "/api/v1/services",
      ticket_comments: "/api/v1/tickets/{id}/comments",
      recurring_tickets: "/api/v1/recurring-tickets",
      recurring_ticket: "/api/v1/recurring-tickets/{id}",
      changes: "/api/v1/changes",
      change: "/api/v1/changes/{id}",
      change_transitions: "/api/v1/changes/{id}/transitions",
      change_approval: "/api/v1/changes/{id}/approvals/{approval_id}",
      change_comments: "/api/v1/changes/{id}/comments",
      problems: "/api/v1/problems",
      problem: "/api/v1/problems/{id}",
      problem_transitions: "/api/v1/problems/{id}/transitions",
      problem_comments: "/api/v1/problems/{id}/comments",
      categories: "/api/v1/categories",
      groups: "/api/v1/groups",
      users: "/api/v1/users",
      import: "/api/v1/import/{tickets|problems|changes}",
      import_update: "/api/v1/import/{tickets|problems|changes}/{import_ref}",
      attachments: "/api/v1/{tickets|changes|problems|assets|licenses}/{id}/attachments",
      attachment: "/api/v1/{tickets|changes|problems|assets|licenses}/{id}/attachments/{attachment_id}",
    },
  });
}
