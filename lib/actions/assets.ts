"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { ASSET_TYPES, ASSET_STATUSES, ASSET_RELATION_TYPES, changeRef, ticketRef } from "@/lib/constants";
import { canActOnTicket } from "@/lib/authz";
import { canAttachToChange, INACTIVE_ASSET_MESSAGE } from "@/lib/asset-link-rules";
import { attachAffectedCi, detachAffectedCi } from "@/lib/actions/change-assets";
import type { TicketActionResult as LinkResult } from "@/lib/ticket-core";

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum(ASSET_TYPES),
  status: z.enum(ASSET_STATUSES).default("IN_USE"),
  assetTag: optionalText,
  serial: optionalText,
  model: optionalText,
  manufacturer: optionalText,
  location: optionalText,
  locationId: optionalId,
  ipAddress: optionalText,
  os: optionalText,
  ownerId: optionalId,
  groupId: optionalId,
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export async function createAsset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAgentA();
  if (!me) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // assetTag is unique — answer with a field error, not an unhandled 500.
  if (data.assetTag && (await db.asset.findFirst({ where: { assetTag: data.assetTag }, select: { id: true } }))) {
    return { error: "Please fix the errors below.", fieldErrors: { assetTag: ["This asset tag is already in use."] } };
  }
  // locationId is an FK — answer with a field error, not a constraint failure.
  if (data.locationId && !(await db.location.findUnique({ where: { id: data.locationId }, select: { id: true } }))) {
    return { error: "Please fix the errors below.", fieldErrors: { locationId: ["This location no longer exists."] } };
  }
  const asset = await db.asset.create({ data });

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "Asset",
    entityId: asset.id,
    summary: `Created asset "${asset.name}"`,
  });

  revalidatePath("/assets");
  redirect(`/assets/${asset.id}`);
}

const updateSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["status", "ownerId", "groupId"]),
  value: z.string(),
});

export async function updateAssetField(formData: FormData) {
  const me = await requireAgentA();
  if (!me) return;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  // Validate the status against the String-backed enum and verify FKs exist so
  // a hand-crafted request can't set an invalid status or a dangling owner/group.
  if (field === "status" && !ASSET_STATUSES.includes(v as (typeof ASSET_STATUSES)[number])) return;
  if (field === "ownerId" && v !== null) {
    const owner = await db.user.findUnique({ where: { id: v }, select: { id: true } });
    if (!owner) return;
  }
  if (field === "groupId" && v !== null) {
    const group = await db.group.findUnique({ where: { id: v }, select: { id: true } });
    if (!group) return;
  }

  await db.asset.update({ where: { id }, data: { [field]: v } });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Asset",
    entityId: id,
    summary: `Updated ${field}`,
  });
  revalidatePath(`/assets/${id}`);
  revalidatePath("/assets");
}

// ── Full edit with field-level history ──────────────────────────────────────

async function requireAgentA() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s && !Number.isNaN(Number(s)) ? Number(s) : null;
};
const dat = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(s) : null;
};
const rel = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s && s !== "none" ? s : null;
};

export async function updateAsset(formData: FormData) {
  const me = await requireAgentA();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) return;

  const data = {
    name: String(formData.get("name") ?? existing.name).trim() || existing.name,
    assetTag: str(formData.get("assetTag")),
    type: String(formData.get("type") ?? existing.type),
    status: String(formData.get("status") ?? existing.status),
    serial: str(formData.get("serial")),
    model: str(formData.get("model")),
    manufacturer: str(formData.get("manufacturer")),
    os: str(formData.get("os")),
    cpu: str(formData.get("cpu")),
    ramGb: num(formData.get("ramGb")),
    storageGb: num(formData.get("storageGb")),
    ipAddress: str(formData.get("ipAddress")),
    macAddress: str(formData.get("macAddress")),
    location: str(formData.get("location")),
    locationId: rel(formData.get("locationId")),
    ownerId: rel(formData.get("ownerId")),
    groupId: rel(formData.get("groupId")),
    cost: num(formData.get("cost")),
    notes: str(formData.get("notes")),
    purchaseDate: dat(formData.get("purchaseDate")),
    warrantyEnd: dat(formData.get("warrantyEnd")),
  };

  // compute which fields changed for a readable audit trail
  const changed: string[] = [];
  for (const key of Object.keys(data) as (keyof typeof data)[]) {
    const before = (existing as Record<string, unknown>)[key];
    const after = data[key];
    const norm = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : x ?? null);
    if (norm(before) !== norm(after)) changed.push(key);
  }

  await db.asset.update({ where: { id }, data });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Asset",
    entityId: id,
    summary: changed.length ? `Edited ${changed.join(", ")}` : "Saved (no changes)",
    meta: { changed },
  });
  revalidatePath(`/assets/${id}`);
  revalidatePath("/assets");
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete an asset. Related edges (AssetRelation, TicketAsset, ChangeAsset) are
 * removed automatically via `onDelete: Cascade` in the schema, so this never
 * orphans a join row or blocks on an FK. Redirects to the list on success.
 */
export async function deleteAsset(formData: FormData) {
  const me = await requireAgentA();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const asset = await db.asset.findUnique({ where: { id }, select: { name: true } });
  if (!asset) return;
  await db.asset.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Asset", entityId: id, summary: `Deleted asset "${asset.name}"` });
  revalidatePath("/assets");
  redirect("/assets");
}

// ── Asset-to-asset relations (CMDB dependency graph) ─────────────────────────

export async function addAssetRelation(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const type = String(formData.get("type") ?? "DEPENDS_ON");
  // No self-links, and the type must be a known relation kind.
  if (!sourceId || !targetId || sourceId === targetId) return refused("Choose a different asset.");
  if (!ASSET_RELATION_TYPES.includes(type as (typeof ASSET_RELATION_TYPES)[number])) return refused("Unknown relationship type.");
  // Both endpoints must exist — never create an edge to a phantom asset.
  const [source, target] = await Promise.all([
    db.asset.findUnique({ where: { id: sourceId }, select: { id: true } }),
    db.asset.findUnique({ where: { id: targetId }, select: { id: true } }),
  ]);
  if (!source || !target) return refused(ASSET_NOT_FOUND);
  await db.assetRelation.upsert({
    where: { sourceId_targetId_type: { sourceId, targetId, type } },
    create: { sourceId, targetId, type },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: sourceId, summary: "Added a relationship" });
  revalidatePath(`/assets/${sourceId}`);
  revalidatePath(`/assets/${targetId}`);
  return { ok: true };
}

export async function deleteAssetRelation(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const relationId = String(formData.get("relationId") ?? "");
  const assetId = String(formData.get("assetId") ?? "");
  if (!relationId) return refused("Missing relationship.");
  await db.assetRelation.delete({ where: { id: relationId } }).catch(() => {});
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: "Removed a relationship" });
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

// ── Links to tickets and changes (asset side) ────────────────────────────────

const NOT_AUTHORISED = "You are not signed in as an agent.";
const ASSET_NOT_FOUND = "Asset not found.";
const refused = (error: string): LinkResult => ({ ok: false, error });

/** Load the ticket and confirm the actor may change it — the same bar as linking from the ticket page. */
async function checkCanActOnTicket(ticketId: number, me: { id: string; role: string }): Promise<string | null> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { assigneeId: true, groupId: true },
  });
  if (!ticket) return "Ticket not found.";
  if (!(await canActOnTicket(me, ticket))) {
    return "You can't change this ticket — it belongs to a group you're not a member of.";
  }
  return null;
}

/** Link a ticket to an asset (writes the same TicketAsset row as the ticket page). */
export async function linkTicketToAsset(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const assetId = String(formData.get("assetId") ?? "").trim();
  const ticketId = Number(formData.get("ticketId"));
  if (!assetId || !ticketId) return refused("Choose a ticket.");
  if (!(await db.asset.findUnique({ where: { id: assetId }, select: { id: true } }))) return refused(ASSET_NOT_FOUND);
  const denied = await checkCanActOnTicket(ticketId, me);
  if (denied) return refused(denied);

  await db.ticketAsset.upsert({
    where: { ticketId_assetId: { ticketId, assetId } },
    create: { ticketId, assetId },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Linked ticket ${ticketRef(ticketId)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Linked an asset" });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

export async function unlinkTicketFromAsset(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const assetId = String(formData.get("assetId") ?? "").trim();
  const ticketId = Number(formData.get("ticketId"));
  if (!assetId || !ticketId) return refused("Missing link.");
  const denied = await checkCanActOnTicket(ticketId, me);
  if (denied) return refused(denied);

  // An already-removed row is a benign no-op; real DB failures still propagate.
  const row = await db.ticketAsset.findUnique({ where: { ticketId_assetId: { ticketId, assetId } }, select: { ticketId: true } });
  if (!row) return { ok: true };
  await db.ticketAsset.delete({ where: { ticketId_assetId: { ticketId, assetId } } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Unlinked ticket ${ticketRef(ticketId)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Unlinked an asset" });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

/**
 * Mark this asset as affected by a change. Retired/disposed assets are refused
 * (as in the change page's CI picker); the write and its Change audit entry are
 * the change page's own `attachAffectedCi`.
 */
export async function addAssetToChange(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const assetId = String(formData.get("assetId") ?? "").trim();
  const changeId = Number(formData.get("changeId"));
  if (!assetId || !changeId) return refused("Choose a change.");
  const [asset, change] = await Promise.all([
    db.asset.findUnique({ where: { id: assetId }, select: { status: true } }),
    db.change.findUnique({ where: { id: changeId }, select: { id: true } }),
  ]);
  if (!asset) return refused(ASSET_NOT_FOUND);
  if (!change) return refused("Change not found.");
  if (!canAttachToChange(asset.status)) return refused(INACTIVE_ASSET_MESSAGE);
  // Already attached: nothing to write, so no audit entry for a no-op.
  if (await db.changeAsset.findUnique({ where: { changeId_assetId: { changeId, assetId } }, select: { assetId: true } })) {
    return { ok: true };
  }

  await attachAffectedCi(formData);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Added to ${changeRef(changeId)}` });
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

export async function removeAssetFromChange(formData: FormData): Promise<LinkResult> {
  const me = await requireAgentA();
  if (!me) return refused(NOT_AUTHORISED);
  const assetId = String(formData.get("assetId") ?? "").trim();
  const changeId = Number(formData.get("changeId"));
  if (!assetId || !changeId) return refused("Missing link.");
  // Already detached: a benign no-op, no audit entry.
  if (!(await db.changeAsset.findUnique({ where: { changeId_assetId: { changeId, assetId } }, select: { assetId: true } }))) {
    return { ok: true };
  }

  await detachAffectedCi(formData);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Removed from ${changeRef(changeId)}` });
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}
