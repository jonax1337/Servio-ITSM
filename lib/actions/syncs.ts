"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { encryptionAvailable, encryptSecret } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";
import { getConnector, getConfigSchema } from "@/lib/connectors";
import { executeSyncRun } from "@/lib/sync-runner";
import { getSpec, fieldsFor, CONFIGURABLE_TYPES } from "@/lib/connectors/spec";

export type ActionState = { error?: string; ok?: boolean } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
// base-ui Switch submits "on" when checked, nothing when unchecked.
const checked = (fd: FormData, k: string) => fd.get(k) === "on";

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return null;
  return me;
}

/** Types offered in the create form (i.e. have a config UI + connector). */
const CONFIGURABLE = new Set(CONFIGURABLE_TYPES.map((s) => s.type));

// --------------------------------------------------------------------------
// Run a sync
// --------------------------------------------------------------------------

export async function runSync(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "MANAGER"))
    return { ok: false, message: "Not authorised." };

  const sourceId = str(formData, "sourceId");
  if (!sourceId) return { ok: false, message: "Missing sync source." };

  const source = await db.syncSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ok: false, message: "Sync source not found." };

  const result = await executeSyncRun(source, { trigger: "MANUAL", actorId: me.id });

  revalidatePath("/syncs");
  revalidatePath(`/syncs/${sourceId}`);

  const t = await getT("syncs");
  const counts = { created: result.created, updated: result.updated, failed: result.failed };
  const summary = result.failed ? t("runSummaryFailed", counts) : t("runSummary", counts);
  return {
    ok: result.status !== "FAILED",
    message:
      result.status === "FAILED"
        ? t("runFailed", { detail: result.log.split("\n").pop() ?? t("runFailedFallback") })
        : t(result.status === "PARTIAL" ? "runPartial" : "runDone", { summary }),
  };
}

export async function toggleSyncActive(formData: FormData) {
  const me = await requireAdmin();
  if (!me) return;
  const sourceId = str(formData, "sourceId");
  if (!sourceId) return;

  const isActive = formData.get("isActive") === "true";

  const source = await db.syncSource.update({
    where: { id: sourceId },
    data: { isActive },
  });

  await writeAudit({
    userId: me.id,
    action: "SYNC",
    entity: "SyncSource",
    entityId: sourceId,
    summary: `${isActive ? "Activated" : "Paused"} sync "${source.name}"`,
  });

  revalidatePath("/syncs");
  revalidatePath(`/syncs/${sourceId}`);
}

// --------------------------------------------------------------------------
// Create / update / delete a sync source
// --------------------------------------------------------------------------

function safeParseObj(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Resolve the source scope for a type: honour the form value, else the default. */
function resolveScope(type: string, requested: string): string {
  const spec = getSpec(type);
  if (!spec) return "USERS";
  return spec.scopes.includes(requested) ? requested : spec.scopes[0];
}

/**
 * Assemble a connector's flat config from the form, driven by its field spec for
 * the given scope — so every connector shares one builder. Secret fields are
 * encrypted at rest; a blank secret keeps the stored value ("leave blank to keep").
 */
function buildConfig(
  type: string,
  scope: string,
  fd: FormData,
  prevRaw?: string,
): Record<string, unknown> {
  const spec = getSpec(type);
  if (!spec) return {};
  const prev = safeParseObj(prevRaw);
  const out: Record<string, unknown> = {};
  for (const f of fieldsFor(spec, scope)) {
    if (spec.secretFields.includes(f.name)) {
      const v = str(fd, f.name);
      out[f.name] = v ? encryptSecret(v) : typeof prev[f.name] === "string" ? prev[f.name] : "";
    } else if (f.type === "switch") {
      out[f.name] = checked(fd, f.name);
    } else if (f.type === "number") {
      const n = Number(str(fd, f.name));
      out[f.name] = Number.isFinite(n) && n > 0 ? n : (spec.defaults[f.name] ?? 0);
    } else {
      out[f.name] = str(fd, f.name);
    }
  }
  return out;
}

/** True when the form submitted a value for any of the type's secret fields. */
function hasSecretInput(type: string, fd: FormData): boolean {
  return (getSpec(type)?.secretFields ?? []).some((k) => str(fd, k).length > 0);
}

/** Ensure the required mapping fields for the scope are set (skips fixed-mapping types). */
function requiredMappingError(type: string, scope: string, config: Record<string, unknown>): string | null {
  const spec = getSpec(type);
  if (!spec || (spec.mapping[scope] ?? []).length === 0) return null;
  const has = (k: string) => typeof config[k] === "string" && (config[k] as string).trim().length > 0;
  if (scope === "ASSETS") {
    if (!has("externalId") || !has("name"))
      return "External ID and Name mappings are required for asset import.";
  } else if (!has("externalId") || !has("email")) {
    return "External ID and Email mappings are required for user import.";
  }
  return null;
}

/** Validate the assembled config against the type's schema. Returns an error string or null. */
function validateConfig(type: string, config: unknown): string | null {
  const schema = getConfigSchema(type);
  if (!schema) return null;
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".");
    return `Invalid configuration${path ? ` (${path})` : ""}: ${first?.message ?? "check the fields"}.`;
  }
  return null;
}

export async function createSyncSource(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised." };

  const name = str(fd, "name");
  const type = str(fd, "type");
  if (!name) return { error: "Name is required." };
  if (!CONFIGURABLE.has(type)) return { error: "Unsupported sync type." };

  const scope = resolveScope(type, str(fd, "scope"));

  if (hasSecretInput(type, fd) && !encryptionAvailable())
    return {
      error:
        "Encryption key not configured — set a valid SETTINGS_ENCRYPTION_KEY to store secrets.",
    };

  const config = buildConfig(type, scope, fd);
  const invalid = validateConfig(type, config) ?? requiredMappingError(type, scope, config);
  if (invalid) return { error: invalid };

  const schedule = str(fd, "schedule") || null;

  let created;
  try {
    created = await db.syncSource.create({
      data: {
        name,
        type,
        direction: "IMPORT",
        scope,
        schedule,
        config: JSON.stringify(config),
        isActive: true,
      },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      return { error: "A sync source with that name already exists." };
    return { error: "Could not create the sync source. Please try again." };
  }

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "SyncSource",
    entityId: created.id,
    summary: `Created sync source "${name}" (${type})`,
  });

  revalidatePath("/syncs");
  redirect(`/syncs/${created.id}`);
}

export async function updateSyncSource(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised." };

  const id = str(fd, "id");
  if (!id) return { error: "Missing sync source." };
  const existing = await db.syncSource.findUnique({ where: { id } });
  if (!existing) return { error: "Sync source not found." };

  const name = str(fd, "name");
  if (!name) return { error: "Name is required." };

  if (hasSecretInput(existing.type, fd) && !encryptionAvailable())
    return {
      error:
        "Encryption key not configured — set a valid SETTINGS_ENCRYPTION_KEY to store secrets.",
    };

  const config = buildConfig(existing.type, existing.scope, fd, existing.config);
  const invalid =
    validateConfig(existing.type, config) ??
    requiredMappingError(existing.type, existing.scope, config);
  if (invalid) return { error: invalid };

  const schedule = str(fd, "schedule") || null;

  try {
    await db.syncSource.update({
      where: { id },
      data: { name, schedule, config: JSON.stringify(config) },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      return { error: "A sync source with that name already exists." };
    return { error: "Could not save the sync source. Please try again." };
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "SyncSource",
    entityId: id,
    summary: `Updated sync source "${name}"`,
  });

  revalidatePath("/syncs");
  revalidatePath(`/syncs/${id}`);
  redirect(`/syncs/${id}`);
}

export async function deleteSyncSource(fd: FormData) {
  const me = await requireAdmin();
  if (!me) return;
  const id = str(fd, "id");
  if (!id) return;

  const source = await db.syncSource.findUnique({ where: { id } });
  if (!source) return;

  // Detach imported records first (keep the users/assets, drop the link) so the
  // delete never fails on the relation regardless of the DB's FK behaviour.
  await db.user.updateMany({ where: { syncSourceId: id }, data: { syncSourceId: null } });
  await db.asset.updateMany({ where: { syncSourceId: id }, data: { syncSourceId: null } });
  await db.syncSource.delete({ where: { id } });

  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "SyncSource",
    entityId: id,
    summary: `Deleted sync source "${source.name}"`,
  });

  revalidatePath("/syncs");
  redirect("/syncs");
}

/** Test connectivity for a saved source (uses its stored, encrypted credentials). */
export async function testSyncConnection(
  _prev: ActionState & { message?: string },
  fd: FormData,
): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised." };

  const id = str(fd, "id");
  if (!id) return { error: "Save the source before testing the connection." };

  const source = await db.syncSource.findUnique({ where: { id } });
  if (!source) return { error: "Sync source not found." };

  const connector = getConnector(source.type);
  if (!connector) return { error: (await getT("syncs"))("noConnector", { type: source.type }) };

  const res = await connector.test(source);
  return res.ok ? { ok: true, message: res.message } : { error: res.message };
}
