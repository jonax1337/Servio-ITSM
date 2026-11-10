"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { AFFECTED_CI_SEARCH_LIMIT, problemAssetSearchWhere } from "@/lib/affected-ci-search";
import { assetSetDiff } from "@/lib/api-contract-input";
import { distinctIds } from "@/lib/utils";

/**
 * Affected-CI (configuration item) linkage for Problems, like lib/actions/change-assets.ts for
 * changes: a ProblemAsset row marks an asset as affected by a problem. The problem page derives
 * the affected services from them (lib/service-graph.ts `problemAffectedServices`).
 *
 * Agent+ gated, like the rest of problem editing. Links stay editable on a closed problem
 * (lib/problem-rules.ts locks only the descriptive fields).
 */

export type ProblemAssetResult = { ok: true } | { ok: false; error: string };

const OK: ProblemAssetResult = { ok: true };
const refuse = (error: string): ProblemAssetResult => ({ ok: false, error });
const NOT_AUTHORISED = "Not authorised.";
const PROBLEM_NOT_FOUND = "Problem not found.";
const UNKNOWN_AFFECTED_CI = "One of the selected configuration items no longer exists.";

const linkSchema = z.object({ problemId: z.coerce.number().int().positive(), assetId: z.string().min(1) });

/** Configuration items matching the typed text that are not yet an affected CI of the problem. */
export async function searchProblemCis(problemId: number, query: string): Promise<{ value: string; label: string; hint: string }[]> {
  if (!(await requireAgentUser())) return [];
  const assets = await db.asset.findMany({
    where: problemAssetSearchWhere(query, problemId),
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
    take: AFFECTED_CI_SEARCH_LIMIT,
  });
  return assets.map((a) => ({ value: a.id, label: a.name, hint: a.type }));
}

/** Mark an asset as affected by a problem. Idempotent (honours the composite PK). */
export async function attachProblemAsset(formData: FormData): Promise<ProblemAssetResult> {
  const me = await requireAgentUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Choose a configuration item.");
  const { problemId, assetId } = parsed.data;

  const [problem, asset] = await Promise.all([
    db.problem.findUnique({ where: { id: problemId }, select: { id: true } }),
    db.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true } }),
  ]);
  if (!problem) return refuse(PROBLEM_NOT_FOUND);
  if (!asset) return refuse(UNKNOWN_AFFECTED_CI);

  const exists = await db.problemAsset.findUnique({ where: { problemId_assetId: { problemId, assetId } }, select: { assetId: true } });
  if (exists) return OK;
  await db.problemAsset.create({ data: { problemId, assetId } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: problemId, summary: `Marked "${asset.name}" as an affected CI` });
  revalidatePath(`/problems/${problemId}`);
  revalidatePath(`/assets/${assetId}`);
  return OK;
}

/** Remove an affected CI from a problem. An already-removed link is a benign no-op. */
export async function detachProblemAsset(formData: FormData): Promise<ProblemAssetResult> {
  const me = await requireAgentUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Missing link.");
  const { problemId, assetId } = parsed.data;

  const removed = await db.problemAsset.deleteMany({ where: { problemId, assetId } });
  if (removed.count === 0) return OK;
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { name: true } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: problemId, summary: `Removed affected CI${asset ? ` "${asset.name}"` : ""}` });
  revalidatePath(`/problems/${problemId}`);
  revalidatePath(`/assets/${assetId}`);
  return OK;
}

/**
 * Bring a problem's affected CIs to exactly the `assetIds` (repeated form key), for the REST API's
 * `asset_ids`. An unknown asset refuses the whole write; an unchanged set writes nothing.
 */
export async function setProblemAssets(formData: FormData): Promise<ProblemAssetResult> {
  const me = await requireAgentUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const problemId = Number(formData.get("id"));
  if (!Number.isInteger(problemId) || problemId <= 0) return refuse("That change isn't valid for this problem.");
  const wanted = distinctIds(formData.getAll("assetIds"));

  const [problem, found, current] = await Promise.all([
    db.problem.findUnique({ where: { id: problemId }, select: { id: true } }),
    wanted.length ? db.asset.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } }) : [],
    db.problemAsset.findMany({ where: { problemId }, select: { assetId: true, asset: { select: { name: true } } } }),
  ]);
  if (!problem) return refuse(PROBLEM_NOT_FOUND);
  if (found.length !== wanted.length) return refuse(UNKNOWN_AFFECTED_CI);

  const { add, remove } = assetSetDiff(current.map((c) => c.assetId), wanted);
  if (add.length === 0 && remove.length === 0) return OK;
  await db.$transaction([
    ...(remove.length ? [db.problemAsset.deleteMany({ where: { problemId, assetId: { in: remove } } })] : []),
    ...(add.length ? [db.problemAsset.createMany({ data: add.map((assetId) => ({ problemId, assetId })) })] : []),
  ]);
  const names = new Map([...found.map((a) => [a.id, a.name] as const), ...current.map((c) => [c.assetId, c.asset.name] as const)]);
  for (const id of add) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: problemId, summary: `Marked "${names.get(id)}" as an affected CI` });
    revalidatePath(`/assets/${id}`);
  }
  for (const id of remove) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: problemId, summary: `Removed affected CI "${names.get(id)}"` });
    revalidatePath(`/assets/${id}`);
  }
  revalidatePath(`/problems/${problemId}`);
  return OK;
}
