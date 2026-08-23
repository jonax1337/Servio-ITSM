"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { LOCATION_TYPES } from "@/lib/constants";

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const opt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const schema = z.object({
  name: z.string().min(2, "Name is required"),
  type: z.enum(LOCATION_TYPES),
});

export type LocationState = { error?: string } | undefined;

export async function createLocation(_prev: LocationState, formData: FormData): Promise<LocationState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const parentId = opt(formData.get("parentId"));
  const loc = await db.location.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      parentId: parentId && parentId !== "none" ? parentId : null,
      address: opt(formData.get("address")),
      city: opt(formData.get("city")),
      country: opt(formData.get("country")),
      notes: opt(formData.get("notes")),
    },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Location", entityId: loc.id, summary: `Created location "${loc.name}"` });
  revalidatePath("/locations");
  return undefined;
}

export async function updateLocation(_prev: LocationState, formData: FormData): Promise<LocationState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const parentId = opt(formData.get("parentId"));
  // A location cannot be its own parent, nor sit under one of its own
  // descendants — walk the proposed parent's ancestor chain and reject if we
  // ever reach `id` (same guard as categories).
  if (parentId && parentId !== "none") {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    let cycle = false;
    while (cursor) {
      if (cursor === id) {
        cycle = true;
        break;
      }
      if (seen.has(cursor)) break; // pre-existing cycle: stop, don't loop forever
      seen.add(cursor);
      const node: { parentId: string | null } | null = await db.location.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node?.parentId ?? null;
    }
    if (cycle) return { error: "A location can't be moved under itself or one of its children." };
  }
  await db.location.update({
    where: { id },
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      parentId: parentId && parentId !== "none" && parentId !== id ? parentId : null,
      address: opt(formData.get("address")),
      city: opt(formData.get("city")),
      country: opt(formData.get("country")),
      notes: opt(formData.get("notes")),
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Location", entityId: id, summary: "Edited location" });
  revalidatePath("/locations");
  revalidatePath(`/locations/${id}`);
  return undefined;
}

export async function deleteLocation(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  // detach assets & children first (SetNull not configured, so do it manually)
  await db.asset.updateMany({ where: { locationId: id }, data: { locationId: null } });
  await db.location.updateMany({ where: { parentId: id }, data: { parentId: null } });
  await db.location.delete({ where: { id } }).catch(() => {});
  revalidatePath("/locations");
}
