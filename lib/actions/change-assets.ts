"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

/**
 * Affected-CI (configuration item) linkage for Changes. A ChangeAsset row marks
 * an asset as directly affected by a change; the change detail page then runs
 * `computeImpact` (lib/cmdb-graph.ts) from each affected CI to surface the
 * automated blast-radius / risk of the change.
 *
 * Agent+ gated — the same authorisation bar the rest of change editing uses.
 */

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const attachSchema = z.object({
  changeId: z.coerce.number(),
  assetId: z.string().min(1),
});

/** Attach an affected CI (asset) to a change. Idempotent (honours the composite PK). */
export async function attachAffectedCi(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const parsed = attachSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { changeId, assetId } = parsed.data;

  // Both endpoints must exist — never link a change to a phantom asset.
  const [change, asset] = await Promise.all([
    db.change.findUnique({ where: { id: changeId }, select: { id: true } }),
    db.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true } }),
  ]);
  if (!change || !asset) return;

  // Idempotent: skip if already linked (composite @@id([changeId, assetId])).
  const exists = await db.changeAsset.findUnique({
    where: { changeId_assetId: { changeId, assetId } },
    select: { assetId: true },
  });
  if (exists) return;

  await db.changeAsset.create({ data: { changeId, assetId } });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: `Marked "${asset.name}" as an affected CI`,
  });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
}

const detachSchema = z.object({
  changeId: z.coerce.number(),
  assetId: z.string().min(1),
});

/** Detach an affected CI from a change. */
export async function detachAffectedCi(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const parsed = detachSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { changeId, assetId } = parsed.data;

  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { name: true } });
  await db.changeAsset
    .delete({ where: { changeId_assetId: { changeId, assetId } } })
    .catch(() => {});
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: `Removed affected CI${asset ? ` "${asset.name}"` : ""}`,
  });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
}
