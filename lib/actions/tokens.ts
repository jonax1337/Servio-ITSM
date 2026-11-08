"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { TOKEN_SCOPE_VALUES, tokenExpiry, tokenOwnerRefusal } from "@/lib/token-rules";

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  scopes: z.enum(TOKEN_SCOPE_VALUES).default("read"),
  /** Owner of the token (e.g. a service account); defaults to the admin issuing it. */
  userId: z.string().optional(),
  /** YYYY-MM-DD, valid through the end of that day (UTC); empty = never expires. */
  expiresOn: z.string().optional().default(""),
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]>; token?: string }
  | undefined;

export async function createApiToken(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // DB-truth: a demoted/deactivated user with a live JWT must not mint tokens,
  // and API tokens (up to admin scope) are an ADMIN-only capability.
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return { error: "Not authorised" };

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    scopes: formData.get("scopes") ?? "read",
    userId: formData.get("userId") || undefined,
    expiresOn: formData.get("expiresOn") ?? "",
  });
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const expiresAt = tokenExpiry(parsed.data.expiresOn);
  if (expiresAt && "error" in expiresAt) return { error: "Please fix the errors below.", fieldErrors: { expiresOn: [expiresAt.error] } };
  const owner = await db.user.findUnique({
    where: { id: parsed.data.userId ?? me.id },
    select: { id: true, email: true, isActive: true, role: true },
  });
  const refusal = tokenOwnerRefusal(owner, parsed.data.scopes);
  if (refusal || !owner) return { error: "Please fix the errors below.", fieldErrors: { userId: [refusal ?? ""] } };

  const raw = "servio_pat_" + nanoid(32);
  const prefix = raw.slice(0, 18);
  const tokenHash = await bcrypt.hash(raw, 10);

  const token = await db.apiToken.create({
    data: {
      name: parsed.data.name.trim(),
      prefix,
      tokenHash,
      scopes: parsed.data.scopes,
      userId: owner.id,
      expiresAt,
    },
  });

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "ApiToken",
    entityId: token.id,
    summary: `Created API token "${token.name}"${owner.id === me.id ? "" : ` for ${owner.email}`}${expiresAt ? `, expires ${expiresAt.toISOString().slice(0, 10)}` : ""}`,
    meta: { ownerId: owner.id, scopes: parsed.data.scopes, expiresAt: expiresAt?.toISOString() ?? null },
  });

  revalidatePath("/settings/api");
  return { token: raw };
}

export async function revokeApiToken(formData: FormData) {
  // DB-truth role, not the stale JWT: a demoted ex-admin must not keep the
  // admin-wide revoke power, and a deactivated user must not revoke at all.
  // Minting/revoking API tokens is an ADMIN-only capability.
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const token = await db.apiToken.findFirst({ where: { id } });
  if (!token) return;

  await db.apiToken.update({
    where: { id: token.id },
    data: { revoked: true },
  });

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "ApiToken",
    entityId: id,
    summary: `Revoked API token "${token.name}"`,
  });

  revalidatePath("/settings/api");
}
