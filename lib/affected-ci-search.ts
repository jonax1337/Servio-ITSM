import type { Prisma } from "@prisma/client";

/** How many configuration items one search offers for a change's affected CIs. */
export const AFFECTED_CI_SEARCH_LIMIT = 20;
const MAX_QUERY_CHARS = 80;
const RETIRED_STATUSES = ["RETIRED", "DISPOSED"];

/** In-service assets whose name, asset tag or serial contains the typed text; with no text, every in-service asset. */
export function affectedCiSearchWhere(query: string): Prisma.AssetWhereInput {
  const text = query.trim().slice(0, MAX_QUERY_CHARS);
  const inService: Prisma.AssetWhereInput = { status: { notIn: RETIRED_STATUSES } };
  if (!text) return inService;
  return {
    ...inService,
    OR: [{ name: { contains: text } }, { assetTag: { contains: text } }, { serial: { contains: text } }],
  };
}

/** The in-service assets matching the typed text that are not yet an affected CI of the change. */
export function attachableCiSearchWhere(query: string, changeId: number): Prisma.AssetWhereInput {
  return { ...affectedCiSearchWhere(query), changes: { none: { changeId } } };
}
