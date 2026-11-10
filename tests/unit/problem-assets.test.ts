import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A problem's affected assets: the actions behind the problem page and the REST API's `asset_ids`
 * (attach, detach, replace the set), the API contract, the serializer and the derived affected services.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const world = vi.hoisted(() => ({
  problems: new Set<number>([7]),
  assets: new Map<string, string>([["a1", "mail-01"], ["a2", "db-01"], ["a3", "web-01"]]),
  links: [] as { problemId: number; assetId: string }[],
  ticketLinks: [] as { assetId: string }[],
  changeLinks: [] as { assetId: string }[],
  audits: [] as { entityId: number | string; summary?: string }[],
  agent: true,
  closureFor: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { entityId: number | string; summary?: string }) => { world.audits.push(a); },
}));
vi.mock("@/lib/session", () => ({ requireAgentUser: async () => (world.agent ? { id: "agent1", role: "AGENT" } : null) }));
vi.mock("@/lib/cmdb-graph", () => ({
  failureClosure: async (ids: string[]) => {
    world.closureFor.push([...ids]);
    return new Map(ids.map((id) => [id, { depth: 0 }]));
  },
}));
vi.mock("@/lib/db", () => {
  const key = (w: Row) => w.problemId_assetId as { problemId: number; assetId: string } | undefined;
  const db: Row = {
    problem: { findUnique: async ({ where }: { where: { id: number } }) => (world.problems.has(where.id) ? { id: where.id } : null) },
    asset: {
      findUnique: async ({ where }: { where: { id: string } }) => (world.assets.has(where.id) ? { id: where.id, name: world.assets.get(where.id) } : null),
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => world.assets.has(id)).map((id) => ({ id, name: world.assets.get(id) })),
      count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => world.assets.has(id)).length,
    },
    problemAsset: {
      findUnique: async ({ where }: { where: Row }) => {
        const k = key(where)!;
        return world.links.find((l) => l.problemId === k.problemId && l.assetId === k.assetId) ?? null;
      },
      findMany: async ({ where }: { where: { problemId: number } }) =>
        world.links.filter((l) => l.problemId === where.problemId).map((l) => ({ assetId: l.assetId, asset: { name: world.assets.get(l.assetId) } })),
      create: async ({ data }: { data: { problemId: number; assetId: string } }) => { world.links.push(data); return data; },
      createMany: async ({ data }: { data: { problemId: number; assetId: string }[] }) => { world.links.push(...data); return { count: data.length }; },
      deleteMany: async ({ where }: { where: { problemId: number; assetId: string | { in: string[] } } }) => {
        const ids = typeof where.assetId === "string" ? [where.assetId] : where.assetId.in;
        const before = world.links.length;
        world.links = world.links.filter((l) => !(l.problemId === where.problemId && ids.includes(l.assetId)));
        return { count: before - world.links.length };
      },
    },
    ticketAsset: { findMany: async () => world.ticketLinks },
    changeAsset: { findMany: async () => world.changeLinks },
    serviceAsset: { findMany: async () => [] },
    serviceDependency: { findMany: async () => [] },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { db };
});

import { attachProblemAsset, detachProblemAsset, setProblemAssets } from "@/lib/actions/problem-assets";
import { problemAffectedServices } from "@/lib/service-graph";
import { problemCreateSchema, problemEditSteps, problemPatchSchema, refusalStatus } from "@/lib/api-itsm-input";
import { problemAssetSearchWhere } from "@/lib/affected-ci-search";
import { serializeProblem } from "@/app/api/v1/_serializers";

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

beforeEach(() => {
  world.links = [];
  world.ticketLinks = [];
  world.changeLinks = [];
  world.audits = [];
  world.agent = true;
  world.closureFor = [];
});

describe("attachProblemAsset / detachProblemAsset", () => {
  it("links an asset, audits it and is idempotent", async () => {
    expect(await attachProblemAsset(form({ problemId: "7", assetId: "a1" }))).toEqual({ ok: true });
    expect(world.links).toEqual([{ problemId: 7, assetId: "a1" }]);
    expect(world.audits).toEqual([expect.objectContaining({ entityId: 7, summary: 'Marked "mail-01" as an affected CI' })]);
    await attachProblemAsset(form({ problemId: "7", assetId: "a1" }));
    expect(world.links).toHaveLength(1);
    expect(world.audits).toHaveLength(1);
  });

  it("refuses a missing problem or asset and a caller who is not an agent", async () => {
    expect(await attachProblemAsset(form({ problemId: "99", assetId: "a1" }))).toEqual({ ok: false, error: "Problem not found." });
    expect(await attachProblemAsset(form({ problemId: "7", assetId: "nope" }))).toMatchObject({ ok: false });
    world.agent = false;
    expect(await attachProblemAsset(form({ problemId: "7", assetId: "a1" }))).toEqual({ ok: false, error: "Not authorised." });
    expect(await detachProblemAsset(form({ problemId: "7", assetId: "a1" }))).toEqual({ ok: false, error: "Not authorised." });
    expect(world.links).toEqual([]);
  });

  it("detaches, audits once, and treats an already-removed link as a no-op", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }];
    expect(await detachProblemAsset(form({ problemId: "7", assetId: "a1" }))).toEqual({ ok: true });
    expect(world.links).toEqual([]);
    expect(world.audits).toEqual([expect.objectContaining({ summary: 'Removed affected CI "mail-01"' })]);
    expect(await detachProblemAsset(form({ problemId: "7", assetId: "a1" }))).toEqual({ ok: true });
    expect(world.audits).toHaveLength(1);
  });
});

describe("setProblemAssets", () => {
  it("replaces the set: adds the new, removes the dropped, audits each", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }, { problemId: 7, assetId: "a2" }];
    expect(await setProblemAssets(form({ id: "7", assetIds: ["a2", "a3"] }))).toEqual({ ok: true });
    expect(world.links.map((l) => l.assetId).sort()).toEqual(["a2", "a3"]);
    expect(world.audits.map((a) => a.summary).sort()).toEqual(['Marked "web-01" as an affected CI', 'Removed affected CI "mail-01"']);
  });

  it("writes nothing for an unchanged set and empties the set with none", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }];
    await setProblemAssets(form({ id: "7", assetIds: ["a1", "a1"] }));
    expect(world.audits).toEqual([]);
    expect(await setProblemAssets(form({ id: "7" }))).toEqual({ ok: true });
    expect(world.links).toEqual([]);
  });

  it("refuses an unknown asset without touching the existing links, and an unknown problem", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }];
    const refused = await setProblemAssets(form({ id: "7", assetIds: ["a2", "ghost"] }));
    expect(refused).toMatchObject({ ok: false });
    expect(refusalStatus((refused as { error: string }).error)).toBe(422);
    expect(world.links).toEqual([{ problemId: 7, assetId: "a1" }]);
    expect(await setProblemAssets(form({ id: "99", assetIds: ["a1"] }))).toEqual({ ok: false, error: "Problem not found." });
  });
});

describe("the API contract", () => {
  it("accepts asset_ids on create and patch and keeps rejecting unknown fields", () => {
    expect(problemCreateSchema.safeParse({ title: "Mail stalls", asset_ids: ["a1", "a2"] }).success).toBe(true);
    expect(problemPatchSchema.safeParse({ asset_ids: [] }).success).toBe(true);
    expect(problemPatchSchema.safeParse({ asset_ids: "a1" }).success).toBe(false);
    expect(problemPatchSchema.safeParse({ assets: ["a1"] }).success).toBe(false);
    expect(problemCreateSchema.safeParse({ title: "Mail stalls", asset_ids: Array.from({ length: 201 }, (_, i) => `a${i}`) }).success).toBe(false);
  });

  it("turns asset_ids into an assets edit step", () => {
    expect(problemEditSteps({ asset_ids: ["a1"] })).toEqual([{ kind: "assets", fields: ["asset_ids"], assetIds: ["a1"] }]);
    expect(problemEditSteps({ priority: "HIGH", asset_ids: [] }).map((s) => s.kind)).toEqual(["field", "assets"]);
  });

  it("returns asset_ids and assets in the response", () => {
    const base = {
      id: 7, title: "t", description: "", status: "NEW", priority: "HIGH", impact: "MEDIUM", rootCause: null, workaround: null,
      customFields: "{}", createdAt: new Date(0), updatedAt: new Date(0), resolvedAt: null,
    };
    const out = serializeProblem({ ...base, assets: [{ asset: { id: "a1", name: "mail-01", type: "SERVER" } }] });
    expect(out.asset_ids).toEqual(["a1"]);
    expect(out.assets).toEqual([{ id: "a1", name: "mail-01", type: "SERVER" }]);
    expect(serializeProblem(base).asset_ids).toEqual([]);
  });

  it("searches in-service assets that are not yet linked to the problem", () => {
    expect(problemAssetSearchWhere("mail", 7)).toMatchObject({ problems: { none: { problemId: 7 } }, status: { notIn: ["RETIRED", "DISPOSED"] } });
  });
});

describe("problemAffectedServices", () => {
  it("derives the services from the problem's own assets together with those of its incidents and changes", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }, { problemId: 8, assetId: "other" }];
    world.ticketLinks = [{ assetId: "a2" }, { assetId: "a1" }];
    world.changeLinks = [{ assetId: "a3" }];
    await problemAffectedServices(7);
    expect(world.closureFor).toHaveLength(1);
    expect(world.closureFor[0].sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("works from the problem's own assets alone", async () => {
    world.links = [{ problemId: 7, assetId: "a1" }];
    await problemAffectedServices(7);
    expect(world.closureFor).toEqual([["a1"]]);
  });
});
