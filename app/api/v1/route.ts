import { ok, preflight } from "@/lib/api";

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
    resources: {
      tickets: "/api/v1/tickets",
      ticket: "/api/v1/tickets/{id}",
      assets: "/api/v1/assets",
      asset: "/api/v1/assets/{id}",
      asset_by_ref: "/api/v1/assets/ref/{ref}",
      asset_relations: "/api/v1/assets/{id}/relations",
      vendors: "/api/v1/vendors",
      licenses: "/api/v1/licenses",
      license_assignments: "/api/v1/licenses/{id}/assignments",
      services: "/api/v1/services",
      ticket_comments: "/api/v1/tickets/{id}/comments",
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
    },
  });
}
