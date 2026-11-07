import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guard, apiError, preflight, principalIsAgent } from "@/lib/api";
import { assetUpsertSchema } from "@/lib/api-asset-input";
import { ASSET_INCLUDE } from "../../../_serializers";
import { assetReferenceErrors, assetResponse, createAssetRecord, readAssetBody, uniqueConflict, updateAssetRecord } from "../../../_assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No "/": an encoded slash in a path segment is mangled or refused by many proxies.
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;

export function OPTIONS() {
  return preflight();
}

async function refOf(ctx: { params: Promise<{ ref: string }> }) {
  const ref = decodeURIComponent((await ctx.params).ref);
  return REF_RE.test(ref) ? ref : null;
}

/** The asset with this origin reference (e.g. `opsi:host:ws01.intern`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await guard(req, "read");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const ref = await refOf(ctx);
  const asset = ref ? await db.asset.findUnique({ where: { importRef: ref }, include: ASSET_INCLUDE }) : null;
  if (!asset) return apiError(404, "Asset not found");
  return assetResponse(asset);
}

/**
 * Upsert by origin reference — the entry point for syncs. Creates the asset
 * (201; `name` required) when the reference is new, otherwise writes only the
 * fields sent (200). Re-sending unchanged facts changes nothing and writes no
 * audit row; `meta.changed` lists what did change. The body is strict.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const ref = await refOf(ctx);
  if (!ref) return apiError(422, "Validation failed", { ref: ["1-200 characters: letters, digits and . _ : @ -, starting with a letter or digit"] });

  const body = await readAssetBody(req, assetUpsertSchema);
  if ("response" in body) return body.response;
  const refs = await assetReferenceErrors(body.data);
  if (refs) return apiError(422, "Validation failed", refs);

  try {
    const existing = await db.asset.findUnique({ where: { importRef: ref } });
    if (existing) {
      const { asset, changed } = await updateAssetRecord(existing.id, existing, body.data, auth.principal.userId, `API (${ref})`);
      return assetResponse(asset, { meta: { created: false, changed } });
    }
    if (!body.data.name) return apiError(422, "Validation failed", { name: ["Required to create a new asset"] });
    const asset = await createAssetRecord(
      { type: "SERVER", status: "IN_USE", ...body.data, importRef: ref },
      auth.principal.userId,
      `Created via API (${ref})`,
    );
    return assetResponse(asset, { status: 201, meta: { created: true, changed: Object.keys(body.data) } });
  } catch (err) {
    // Two syncs creating the same ref at once: the loser retries as an update.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target ?? "").includes("importRef")) {
      const winner = await db.asset.findUnique({ where: { importRef: ref } });
      if (winner) {
        const { asset, changed } = await updateAssetRecord(winner.id, winner, body.data, auth.principal.userId, `API (${ref})`);
        return assetResponse(asset, { meta: { created: false, changed } });
      }
    }
    const conflict = uniqueConflict(err);
    if (conflict) return conflict;
    throw err;
  }
}
