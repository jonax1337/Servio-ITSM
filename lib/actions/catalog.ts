"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { createCatalogRequestFor, linkStagedAttachments } from "@/lib/portal-tickets";

export type CatalogState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function createCatalogRequest(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  // DB truth (not the JWT): a deactivated user keeps no catalog powers.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return { error: "Not authenticated" };

  const itemId = String(formData.get("catalogItemId") ?? "");
  const rawAnswers: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("f_")) rawAnswers[k.slice(2)] = String(v);

  const result = await createCatalogRequestFor(me, itemId, rawAnswers);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  await linkStagedAttachments(me.id, result.ticket.id, formData.getAll("attachmentIds").map(String));
  redirect(`/portal/tickets/${result.ticket.id}`);
}

/**
 * Re-request: clone a rejected/cancelled catalog request into a fresh one so a
 * declined request isn't a dead end. Reuses the original's saved form answers and
 * re-runs the full approval flow. Only the original requester may re-request, and
 * only from a cancelled request that came from the catalog.
 */
export async function reRequestCatalogItem(formData: FormData): Promise<void> {
  // DB truth: deactivated users keep no catalog powers.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return;
  const sourceId = Number(formData.get("ticketId"));
  if (!Number.isFinite(sourceId)) return;

  const source = await db.ticket.findFirst({
    where: { id: sourceId, requesterId: me.id },
    select: { id: true, catalogItemId: true, formData: true, status: true },
  });
  // Only re-request a catalog-backed request that was declined/cancelled.
  if (!source || !source.catalogItemId || source.status !== "CANCELLED") return;

  let answers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(source.formData ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        answers[k] = typeof v === "boolean" ? (v ? "on" : "") : Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
      }
    }
  } catch {
    answers = {};
  }

  const result = await createCatalogRequestFor(me, source.catalogItemId, answers);
  if (!result.ok) return;

  revalidatePath(`/portal/tickets/${sourceId}`);
  revalidatePath("/portal/tickets");
  redirect(`/portal/tickets/${result.ticket.id}`);
}
