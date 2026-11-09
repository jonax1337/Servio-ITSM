import { describe, expect, it } from "vitest";
import {
  affectedServices,
  assetsHitBy,
  dependencyCycle,
  planAssetSet,
  planDependencies,
  serviceClosure,
  type ServiceEdge,
} from "@/lib/service-graph-rules";

// web → api → db, api → auth, report → db
const edges: ServiceEdge[] = [
  { from: "web", to: "api" },
  { from: "api", to: "db" },
  { from: "api", to: "auth" },
  { from: "report", to: "db" },
];

describe("dependencyCycle", () => {
  it("refuses a self-dependency", () => {
    expect(dependencyCycle(edges, "api", ["api"])).toEqual(["api", "api"]);
  });

  it("finds a direct two-node cycle", () => {
    expect(dependencyCycle(edges, "db", ["api"])).toEqual(["db", "api", "db"]);
  });

  it("finds a longer cycle and names every hop", () => {
    expect(dependencyCycle(edges, "db", ["web"])).toEqual(["db", "web", "api", "db"]);
  });

  it("accepts an acyclic set, including a diamond", () => {
    expect(dependencyCycle(edges, "web", ["api", "db", "auth"])).toBeNull();
    expect(dependencyCycle(edges, "report", ["auth"])).toBeNull();
  });

  it("ignores the edges the new set replaces", () => {
    // api currently depends on db; replacing api's set with [] then letting db depend on api is fine,
    // but checking api's own replacement must not see its old outgoing edges as a path.
    expect(dependencyCycle(edges, "api", ["auth"])).toBeNull();
    const withBackEdge = [...edges, { from: "db", to: "web" }];
    // db → web → api → db would cycle only through api's old edge to db, which the new set drops.
    expect(dependencyCycle(withBackEdge, "api", ["auth"])).toBeNull();
    expect(dependencyCycle(withBackEdge, "api", ["db"])).toEqual(["api", "db", "web", "api"]);
  });

  it("accepts an empty set", () => {
    expect(dependencyCycle(edges, "web", [])).toBeNull();
  });
});

describe("serviceClosure", () => {
  it("walks dependants transitively with their depth and parent", () => {
    const hits = serviceClosure(edges, ["db"], "dependents");
    expect(Object.fromEntries(hits)).toEqual({
      api: { depth: 1, via: "db" },
      report: { depth: 1, via: "db" },
      web: { depth: 2, via: "api" },
    });
  });

  it("walks dependencies the other way and leaves the roots out", () => {
    const hits = serviceClosure(edges, ["web"], "dependencies");
    expect([...hits.keys()].sort()).toEqual(["api", "auth", "db"]);
    expect(hits.has("web")).toBe(false);
  });

  it("terminates on a cyclic graph", () => {
    const cyclic: ServiceEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
    expect(Object.fromEntries(serviceClosure(cyclic, ["a"], "dependents"))).toEqual({ b: { depth: 1, via: "a" } });
  });
});

describe("assetsHitBy", () => {
  const failed = new Set(["host"]);
  it("takes down what depends on or runs on a failed asset", () => {
    const hit = assetsHitBy(
      [
        { sourceId: "vm", targetId: "host", type: "RUNS_ON" },
        { sourceId: "app", targetId: "host", type: "DEPENDS_ON" },
      ],
      failed,
    );
    expect(Object.fromEntries(hit)).toEqual({ vm: "host", app: "host" });
  });

  it("takes down what a failed asset hosts or is part of, not what it depends on", () => {
    const hit = assetsHitBy(
      [
        { sourceId: "host", targetId: "vm", type: "HOSTS" },
        { sourceId: "host", targetId: "cluster", type: "PART_OF" },
        { sourceId: "host", targetId: "storage", type: "DEPENDS_ON" },
      ],
      failed,
    );
    expect(Object.fromEntries(hit)).toEqual({ vm: "host", cluster: "host" });
  });

  it("does not propagate along CONNECTS_TO or BACKS_UP", () => {
    const hit = assetsHitBy(
      [
        { sourceId: "switch", targetId: "host", type: "CONNECTS_TO" },
        { sourceId: "backup", targetId: "host", type: "BACKS_UP" },
      ],
      failed,
    );
    expect(hit.size).toBe(0);
  });
});

describe("affectedServices", () => {
  const serviceAssets = [
    { serviceId: "db", assetId: "db-server" },
    { serviceId: "auth", assetId: "idp-vm" },
  ];

  it("lists the services on the failed asset, then their dependants", () => {
    const result = affectedServices({ serviceAssets, edges, failedAssetIds: ["db-server"] });
    expect(result).toEqual([
      { serviceId: "db", depth: 0, direct: true, via: "db-server" },
      { serviceId: "api", depth: 1, direct: false, via: "db" },
      { serviceId: "report", depth: 1, direct: false, via: "db" },
      { serviceId: "web", depth: 2, direct: false, via: "api" },
    ]);
  });

  it("marks only services on a root asset as direct when propagated assets are included", () => {
    const result = affectedServices({ serviceAssets, edges, failedAssetIds: ["host", "idp-vm"], rootAssetIds: ["host"] });
    expect(result.find((r) => r.serviceId === "auth")).toEqual({ serviceId: "auth", depth: 0, direct: false, via: "idp-vm" });
  });

  it("leaves the failed service itself out of a service impact", () => {
    const result = affectedServices({ serviceAssets: [], edges, failedServiceIds: ["api"] });
    expect(result).toEqual([{ serviceId: "web", depth: 1, direct: false, via: "api" }]);
  });

  it("finds nothing when no service runs on the asset", () => {
    expect(affectedServices({ serviceAssets, edges, failedAssetIds: ["printer"] })).toEqual([]);
  });
});

describe("planDependencies (upsert idempotency)", () => {
  const current = [
    { toServiceId: "db", note: "primary store" },
    { toServiceId: "auth", note: null },
  ];

  it("plans nothing when the same set is sent again, in any order", () => {
    const plan = planDependencies(current, [...current].reverse());
    expect(plan).toEqual({ add: [], remove: [], renote: [], changed: false });
  });

  it("adds, removes and re-notes exactly the differences", () => {
    const plan = planDependencies(current, [
      { toServiceId: "db", note: "replica" },
      { toServiceId: "queue", note: null },
    ]);
    expect(plan.add).toEqual([{ toServiceId: "queue", note: null }]);
    expect(plan.remove).toEqual(["auth"]);
    expect(plan.renote).toEqual([{ toServiceId: "db", note: "replica" }]);
    expect(plan.changed).toBe(true);
  });

  it("treats an empty set as removing everything", () => {
    expect(planDependencies(current, []).remove).toEqual(["db", "auth"]);
  });
});

describe("planAssetSet", () => {
  it("is idempotent and order-insensitive", () => {
    expect(planAssetSet(["a", "b"], ["b", "a"])).toEqual({ add: [], remove: [], changed: false });
  });

  it("replaces the set", () => {
    expect(planAssetSet(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"], changed: true });
  });
});
