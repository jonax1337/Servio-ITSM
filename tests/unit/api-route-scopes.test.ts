import { readdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { requiredScope } from "@/lib/api-scopes";

/**
 * Holds every /api/v1 route handler to the scope rule of lib/api-scopes.ts: a
 * token without scopes is refused with exactly the scope `requiredScope()`
 * names for the route's path and method, and a token holding only that scope
 * gets past the guard. A new route (or route group) cannot ship without a
 * declared resource scope, and the OpenAPI spec documents the same scope.
 *
 * The handlers run against a fake database: authentication finds one token of
 * an active ADMIN, and every other query answers null, so a handler that got
 * past the guard soon stops with a 404 or an error, which is all this needs.
 */

const token = vi.hoisted(() => ({ raw: "servio_pat_scopetest_0123456789abcdef", hash: "", scopes: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkApiRate: () => null,
  checkUploadRate: () => null,
}));
vi.mock("@/lib/db", () => {
  const nothing = async () => null;
  const model = (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, { get: (target, key) => (key in target ? target[key as string] : nothing) });
  const tables: Record<string, unknown> = {
    apiToken: model({
      findMany: async () => [{ id: "tok", userId: "owner", tokenHash: token.hash, scopes: token.scopes, expiresAt: null }],
    }),
    user: model({ findUnique: async () => ({ isActive: true, role: "ADMIN" }) }),
  };
  const db: Record<string, unknown> = new Proxy(tables, {
    get: (target, key) => {
      if (key === "$transaction") return async (arg: unknown) => (typeof arg === "function" ? arg(db) : []);
      if (typeof key !== "string" || key === "then") return undefined;
      return (target[key] ??= model());
    },
  });
  return { db };
});

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Endpoint = { file: string; route: string; method: (typeof METHODS)[number]; handler: Handler; params: Record<string, string> };

const API_ROOT = path.join(process.cwd(), "app", "api", "v1");

/** `/tickets/[id]` as the OpenAPI path `/tickets/{id}`. */
function toOpenApiPath(route: string) {
  return route.replace(/\[([^\]]+)\]/g, "{$1}");
}

async function endpoints(): Promise<Endpoint[]> {
  const files = readdirSync(API_ROOT, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "route.ts")
    .map((e) => path.relative(API_ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
  const found: Endpoint[] = [];
  for (const file of files.sort()) {
    const dir = path.posix.dirname(file);
    const route = dir === "." ? "/" : `/${dir}`;
    const params = Object.fromEntries([...route.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], "1"]));
    const mod = (await import(/* @vite-ignore */ `@/app/api/v1/${file}`)) as Record<string, unknown>;
    for (const method of METHODS) {
      if (typeof mod[method] === "function") found.push({ file, route, method, handler: mod[method] as Handler, params });
    }
  }
  return found;
}

function call(e: Endpoint, authorized: boolean) {
  const url = `http://localhost/api/v1${e.route.replace(/\[[^\]]+\]/g, "1")}`;
  const req = new Request(url, { method: e.method, headers: authorized ? { authorization: `Bearer ${token.raw}` } : {} });
  return e.handler(req, { params: Promise.resolve(e.params) });
}

/** The scope a refusal names, or null when the guard let the request through. */
async function refusedScope(e: Endpoint): Promise<string | null> {
  try {
    const res = await call(e, true);
    if (res.status !== 403) return null;
    const body = (await res.clone().json().catch(() => null)) as { error?: { details?: { required_scope?: string } } } | null;
    return body?.error?.details?.required_scope ?? null;
  } catch {
    return null; // past the guard: the fake database made the handler fail
  }
}

let all: Endpoint[] = [];

beforeAll(async () => {
  token.hash = bcrypt.hashSync(token.raw, 4);
  all = await endpoints();
}, 120_000);

describe("/api/v1 route scopes", () => {
  it("finds the route handlers", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((e) => e.route === "/tickets" && e.method === "POST")).toBe(true);
  });

  it("knows the scope of every endpoint (a new route group needs an entry in RESOURCE_BY_SEGMENT)", () => {
    const unknown = all.filter((e) => requiredScope(toOpenApiPath(e.route), e.method) === undefined).map((e) => `${e.method} ${e.route}`);
    expect(unknown).toEqual([]);
  });

  it("refuses a token without scopes, naming the scope the route needs", async () => {
    token.scopes = "";
    const wrong: string[] = [];
    for (const e of all) {
      const expected = requiredScope(toOpenApiPath(e.route), e.method);
      if (!expected) continue;
      const named = await refusedScope(e);
      if (named !== expected) wrong.push(`${e.method} ${e.route}: expected ${expected}, refused with ${named ?? "nothing"}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("lets a token holding only that scope past the guard", async () => {
    const wrong: string[] = [];
    for (const e of all) {
      const expected = requiredScope(toOpenApiPath(e.route), e.method);
      if (!expected) continue;
      token.scopes = expected;
      const named = await refusedScope(e);
      if (named) wrong.push(`${e.method} ${e.route}: holds ${expected}, still refused for ${named}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("refuses an unauthenticated request on every protected endpoint", async () => {
    const open: string[] = [];
    for (const e of all) {
      if (!requiredScope(toOpenApiPath(e.route), e.method)) continue;
      const res = await call(e, false);
      if (res.status !== 401) open.push(`${e.method} ${e.route}: ${res.status}`);
    }
    expect(open).toEqual([]);
  }, 120_000);
});

describe("OpenAPI scopes", () => {
  type Operation = { "x-required-scope"?: string; security?: { bearerAuth: string[] }[] };
  let paths: Record<string, Record<string, Operation>> = {};

  beforeAll(async () => {
    const { GET } = await import("@/app/api/v1/openapi/route");
    paths = ((await GET().json()) as { paths: typeof paths }).paths;
  });

  /** Path parameters differ in spelling between folders and spec (`[relationId]` / `{relation_id}`). */
  const shape = (p: string) => p.replace(/\{[^}]+\}/g, "{}");

  it("documents every protected endpoint", () => {
    const documented = new Set(Object.entries(paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${shape(p)}`)));
    const missing = all
      .filter((e) => requiredScope(toOpenApiPath(e.route), e.method))
      .map((e) => `${e.method} ${shape(toOpenApiPath(e.route))}`)
      .filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it("names the required scope and the scopes that satisfy it on every operation", () => {
    const wrong: string[] = [];
    for (const [p, ops] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const expected = requiredScope(p, method);
        if (expected === null) {
          // A public endpoint (e.g. /health) needs no scope.
          if (op["x-required-scope"] !== undefined) wrong.push(`${method.toUpperCase()} ${p}`);
          continue;
        }
        const alternatives = op.security?.map((r) => r.bearerAuth[0]) ?? [];
        if (op["x-required-scope"] !== expected || !alternatives.includes(expected as string) || !alternatives.includes("admin")) {
          wrong.push(`${method.toUpperCase()} ${p}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
