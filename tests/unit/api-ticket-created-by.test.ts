import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TICKET_INCLUDE, serializeTicket } from "@/app/api/v1/_serializers";

/**
 * `created_by` on a ticket: the account that created it (read-only, set by the server), so an integration can
 * tell a request a person made themselves from one an agent filed on their behalf.
 */

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  token: { raw: "servio_pat_createdby_0123456789abcdef", hash: "", scopes: "tickets:write" },
  role: "AGENT",
  created: [] as Row[],
  updates: [] as Row[],
  audits: [] as string[],
  existing: null as Row | null,
  sla: {} as Row,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkApiRate: () => null,
  checkUploadRate: () => null,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: { summary?: string }) => { world.audits.push(a.summary ?? ""); }, notify: async () => {} }));
vi.mock("@/lib/sla", () => ({ slaCreateData: async () => world.sla, slaRepricePatch: async () => ({}), statusChangeData: () => ({}), ticketCalendar: async () => null }));
vi.mock("@/lib/assignment", () => ({ autoAssignTicket: async () => false, isGroupMember: async () => false }));
vi.mock("@/lib/approval-seating", () => ({ withdrawPendingApprovals: async () => {} }));
vi.mock("@/lib/db", () => {
  const nothing = async () => null;
  const model = (impl: Record<string, unknown> = {}) =>
    new Proxy(impl, { get: (target, key) => (key in target ? target[key as string] : nothing) });
  const base = (): Row => ({
    id: 5, title: "Printer", description: "", type: "INCIDENT", prefix: "INC", status: "OPEN", priority: "MEDIUM", impact: "MEDIUM", urgency: "MEDIUM",
    source: "API", categoryId: null, serviceId: null, groupId: null, assigneeId: null, requesterId: "u1", dueDate: null, dueAt: null, resolveDueAt: null,
    resolvedAt: null, createdAt: new Date(0), updatedAt: new Date(0), requester: null, assignee: null,
  });
  const tables: Record<string, unknown> = {
    apiToken: model({ findMany: async () => [{ id: "tok", userId: "u1", tokenHash: world.token.hash, scopes: world.token.scopes, expiresAt: null }] }),
    user: model({ findUnique: async () => ({ id: "u1", email: "agent@example.test", name: "Agent", isActive: true, role: world.role }) }),
    ticket: model({
      findUnique: async () => world.existing,
      create: async ({ data }: { data: Row }) => { world.created.push(data); return { ...base(), ...data }; },
      update: async ({ data }: { data: Row }) => { world.updates.push(data); return { ...base(), ...world.existing, ...data }; },
      findUniqueOrThrow: async () => ({ ...base(), ...world.existing }),
    }),
  };
  const db: Record<string, unknown> = new Proxy(tables, {
    get: (target, key) => {
      if (typeof key !== "string" || key === "then") return undefined;
      return (target[key] ??= model());
    },
  });
  return { db };
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let handlers: { POST: Handler; PATCH: Handler };

async function send(method: "POST" | "PATCH", body: unknown) {
  const handler = handlers[method];
  const res = await handler(
    new Request("http://localhost/api/v1/tickets", {
      method,
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${world.token.raw}`, "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "5" }) },
  );
  return { status: res.status, json: (await res.json()) as { data?: Row; error?: { message: string; details?: Record<string, string[]> } } };
}

beforeAll(async () => {
  world.token.hash = bcrypt.hashSync(world.token.raw, 4);
  const [collection, item] = await Promise.all([import("@/app/api/v1/tickets/route"), import("@/app/api/v1/tickets/[id]/route")]);
  handlers = { POST: collection.POST as unknown as Handler, PATCH: item.PATCH as unknown as Handler };
}, 60_000);

beforeEach(() => {
  world.role = "AGENT";
  world.token.scopes = "tickets:write";
  world.created = [];
  world.updates = [];
  world.audits = [];
  world.sla = {};
  world.existing = { id: 5, status: "OPEN", priority: "MEDIUM", serviceId: null, slaId: null, groupId: null, assigneeId: null, approvalState: null, dueDate: null, sla: null };
});

const row = {
  id: 7, title: "Password reset", description: "", type: "REQUEST", prefix: "REQ", status: "NEW", priority: "MEDIUM", impact: "MEDIUM",
  urgency: "MEDIUM", source: "PORTAL", categoryId: null, serviceId: null, catalogItem: null, dueAt: null, resolvedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0),
  requester: { id: "u1", name: "Ada", email: "ada@example.com" },
};

describe("created_by on a ticket", () => {
  it("names the creating account with its service-account flag", () => {
    const out = serializeTicket({ ...row, createdBy: { id: "u1", name: "Ada", email: "ada@example.com", isServiceAccount: false } });
    expect(out.created_by).toEqual({ id: "u1", name: "Ada", email: "ada@example.com", service_account: false });
  });

  it("differs from the requester when an integration filed the ticket for someone", () => {
    const out = serializeTicket({
      ...row, source: "API", createdBy: { id: "bot", name: "Integration", email: "bot@example.com", isServiceAccount: true },
    });
    expect(out.created_by).toMatchObject({ id: "bot", service_account: true });
    expect(out.requester?.id).toBe("u1");
  });

  it("is null when the creator is unknown", () => {
    expect(serializeTicket({ ...row, createdBy: null }).created_by).toBeNull();
    expect(serializeTicket(row).created_by).toBeNull();
  });

  it("is loaded by the shared include, reading only the four fields", () => {
    expect(TICKET_INCLUDE.createdBy).toEqual({ select: { id: true, name: true, email: true, isServiceAccount: true } });
  });
});

describe("POST /tickets records the token owner as creator", () => {
  it("also when an agent files the ticket for another requester", async () => {
    const { status } = await send("POST", { title: "Password reset", requester_id: "u2" });
    expect(status).toBe(201);
    expect(world.created[0]).toMatchObject({ requesterId: "u2", createdById: "u1", source: "API" });
  });

  it("for a USER token, who can only file for themselves", async () => {
    world.role = "USER";
    const { status } = await send("POST", { title: "Password reset" });
    expect(status).toBe(201);
    expect(world.created[0]).toMatchObject({ requesterId: "u1", createdById: "u1" });
  });

  it("cannot be set by the caller (a sent created_by_id is not a create field and changes nothing)", async () => {
    const { status } = await send("POST", { title: "Password reset", requester_id: "u2", created_by_id: "u2" });
    expect(status).toBe(201);
    expect(world.created[0]).toMatchObject({ requesterId: "u2", createdById: "u1" });
  });
});
