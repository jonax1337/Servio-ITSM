import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { updateVendor } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { vendorPatchSchema } from "@/lib/api-asset-input";
import { serializeVendor } from "../../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const vendor = await db.vendor.findUnique({ where: { id: (await ctx.params).id } });
  if (!vendor) return apiError(404, "Vendor not found");
  return ok(serializeVendor(vendor));
}

/** Edit a vendor (MANAGER or above). Fields left out keep their value; `null` clears one. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const current = await db.vendor.findUnique({ where: { id } });
  if (!current) return apiError(404, "Vendor not found");
  const body = await readBody(req, vendorPatchSchema);
  if ("response" in body) return body.response;
  const b = body.data;
  // updateVendor replaces every field: send the current values for the ones this PATCH leaves out.
  const pick = <K extends keyof typeof b>(k: K, fallback: string | null) => (k in b ? (b[k] as string | null) : fallback);
  const active = "active" in b ? b.active : current.isActive;
  const form = formOf({
    id,
    name: pick("name", current.name),
    website: pick("website", current.website),
    email: pick("email", current.email),
    phone: pick("phone", current.phone),
    notes: pick("notes", current.notes),
    isActive: active ? "on" : undefined,
  });
  const result = await asActor(auth.principal, () => updateVendor(form));
  if (!result.ok) return refusal(result.error ?? "The request was refused.");
  return ok(serializeVendor(await db.vendor.findUniqueOrThrow({ where: { id } })));
}
