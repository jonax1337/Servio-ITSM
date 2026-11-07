import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { updateLicense } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { licenseForm, licensePatchSchema } from "@/lib/api-asset-input";
import { LICENSE_INCLUDE, serializeLicense } from "../../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const license = await db.softwareLicense.findUnique({ where: { id: (await ctx.params).id }, include: LICENSE_INCLUDE });
  if (!license) return apiError(404, "License not found");
  return ok(serializeLicense(license));
}

/** Edit a license (MANAGER or above). Fields left out keep their value; `null` clears a nullable one. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const current = await db.softwareLicense.findUnique({ where: { id } });
  if (!current) return apiError(404, "License not found");
  const body = await readBody(req, licensePatchSchema);
  if ("response" in body) return body.response;
  const result = await asActor(auth.principal, () => updateLicense(formOf({ id, ...licenseForm(current, body.data) })));
  if (!result.ok) return refusal(result.error ?? "The request was refused.");
  return ok(serializeLicense(await db.softwareLicense.findUniqueOrThrow({ where: { id }, include: LICENSE_INCLUDE })));
}
