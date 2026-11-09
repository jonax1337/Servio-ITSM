import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dueAtSchema, effectiveDue, ticketCreateSchema } from "@/lib/api-ticket-input";
import { serializeTicket } from "@/app/api/v1/_serializers";

/**
 * The manual due date of a ticket over the API (`due_at` on POST and PATCH /tickets): validation,
 * who may set it, that it lands in `dueDate` and never in the SLA columns, and what GET reports.
 */

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  token: { raw: "servio_pat_duetest_0123456789abcdef", hash: "", scopes: "tickets:write" },
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

describe("due_at is a full ISO 8601 timestamp", () => {
  it("needs an offset and a time", () => {
    expect(dueAtSchema.safeParse("2026-12-01T10:00:00Z").success).toBe(true);
    expect(dueAtSchema.safeParse("2026-12-01T10:00:00+01:00").success).toBe(true);
    expect(dueAtSchema.safeParse("2026-12-01T10:00:00").success).toBe(false);
    expect(dueAtSchema.safeParse("2026-12-01").success).toBe(false);
    expect(dueAtSchema.safeParse("tomorrow").success).toBe(false);
    expect(ticketCreateSchema.safeParse({ title: "Printer jams", dueAt: "2026-12-01T10:00:00Z" }).success).toBe(true);
  });
});

describe("which due date a ticket reports", () => {
  const manual = new Date("2026-12-01T10:00:00Z");
  const sla = new Date("2026-11-20T10:00:00Z");

  it("a manual date wins over the SLA deadline, which stays readable as sla_due_at", () => {
    expect(effectiveDue({ dueDate: manual, resolveDueAt: sla, dueAt: sla })).toEqual({ at: manual, source: "MANUAL" });
    const out = serializeTicket({ ...ticketRow(), dueDate: manual, resolveDueAt: sla, dueAt: sla });
    expect(out).toMatchObject({ due_at: manual.toISOString(), due_at_source: "MANUAL", sla_due_at: sla.toISOString() });
  });

  it("without a manual date it is the SLA resolution deadline, as before", () => {
    expect(effectiveDue({ dueDate: null, resolveDueAt: sla, dueAt: null })).toEqual({ at: sla, source: "SLA" });
    expect(serializeTicket({ ...ticketRow(), resolveDueAt: sla, dueAt: sla })).toMatchObject({ due_at: sla.toISOString(), due_at_source: "SLA" });
  });

  it("is empty when neither exists", () => {
    expect(serializeTicket(ticketRow())).toMatchObject({ due_at: null, due_at_source: null, sla_due_at: null });
  });
});

describe("POST /tickets", () => {
  it("stores the date as the manual due date and leaves the SLA columns to the SLA", async () => {
    const slaDue = new Date("2026-11-20T10:00:00Z");
    world.sla = { slaId: "s1", responseDueAt: slaDue, resolveDueAt: slaDue, dueAt: slaDue };
    const { status, json } = await send("POST", { title: "Printer jams", due_at: "2026-12-01T10:00:00+01:00" });
    expect(status).toBe(201);
    expect(world.created[0]).toMatchObject({ dueDate: new Date("2026-12-01T09:00:00Z"), dueAt: slaDue, resolveDueAt: slaDue });
    expect(json.data).toMatchObject({ due_at: "2026-12-01T09:00:00.000Z", due_at_source: "MANUAL", sla_due_at: slaDue.toISOString() });
    expect(world.audits).toContain("Set due date to 2026-12-01T09:00:00.000Z via API");
  });

  it("never puts the value into the SLA mirror column when there is no SLA", async () => {
    await send("POST", { title: "Printer jams", due_at: "2026-12-01T10:00:00Z" });
    expect(world.created[0]).not.toHaveProperty("dueAt");
  });

  it("sets nothing and audits nothing without due_at", async () => {
    const { status } = await send("POST", { title: "Printer jams" });
    expect(status).toBe(201);
    expect(world.created[0]).not.toHaveProperty("dueDate");
    expect(world.audits.some((a) => /due date/i.test(a))).toBe(false);
  });

  it("rejects values that are not full timestamps", async () => {
    for (const due_at of ["2026-12-01", "soon", "2026-12-01T10:00:00", 5, null]) {
      const { status, json } = await send("POST", { title: "Printer jams", due_at });
      expect(status).toBe(422);
      expect(json.error?.details).toHaveProperty("dueAt");
    }
    expect(world.created).toEqual([]);
  });

  it("is for agents: a USER token is told so instead of being ignored", async () => {
    world.role = "USER";
    const { status } = await send("POST", { title: "Printer jams", due_at: "2026-12-01T10:00:00Z" });
    expect(status).toBe(403);
    expect(world.created).toEqual([]);
  });
});

describe("PATCH /tickets/{id}", () => {
  it("sets the manual due date, touches no SLA column and audits it", async () => {
    const { status, json } = await send("PATCH", { due_at: "2026-12-01T10:00:00Z" });
    expect(status).toBe(200);
    expect(world.updates[0]).toEqual({ dueDate: new Date("2026-12-01T10:00:00Z") });
    expect(json.data).toMatchObject({ due_at: "2026-12-01T10:00:00.000Z", due_at_source: "MANUAL" });
    expect(world.audits).toContain("Set due date to 2026-12-01T10:00:00.000Z via API");
  });

  it("clears it with null", async () => {
    world.existing = { ...world.existing, dueDate: new Date("2026-12-01T10:00:00Z") };
    const { status } = await send("PATCH", { due_at: null });
    expect(status).toBe(200);
    expect(world.updates[0]).toEqual({ dueDate: null });
    expect(world.audits).toContain("Cleared due date via API");
  });

  it("can be combined with other fields and is validated", async () => {
    expect((await send("PATCH", { title: "Printer jams again", due_at: "2026-12-01T10:00:00Z" })).status).toBe(200);
    expect(world.updates[0]).toMatchObject({ title: "Printer jams again", dueDate: new Date("2026-12-01T10:00:00Z") });
    world.updates = [];
    const bad = await send("PATCH", { due_at: "next week" });
    expect(bad.status).toBe(422);
    expect(world.updates).toEqual([]);
  });

  it("follows the console's right to act on the ticket: an agent outside the ticket's team is refused", async () => {
    world.existing = { ...world.existing, groupId: "g1", assigneeId: "u9" };
    const { status } = await send("PATCH", { due_at: "2026-12-01T10:00:00Z" });
    expect(status).toBe(403);
    expect(world.updates).toEqual([]);
  });

  it("is open to a manager on any ticket, and to a ticket's assignee", async () => {
    world.existing = { ...world.existing, groupId: "g1", assigneeId: "u9" };
    world.role = "MANAGER";
    expect((await send("PATCH", { due_at: "2026-12-01T10:00:00Z" })).status).toBe(200);
    world.role = "AGENT";
    world.existing = { ...world.existing, assigneeId: "u1" };
    expect((await send("PATCH", { due_at: "2026-12-01T10:00:00Z" })).status).toBe(200);
  });

  it("is not a USER's to change, and needs the tickets:write scope", async () => {
    world.role = "USER";
    expect((await send("PATCH", { due_at: "2026-12-01T10:00:00Z" })).status).toBe(404);
    world.role = "AGENT";
    world.token.scopes = "tickets:read";
    expect((await send("PATCH", { due_at: "2026-12-01T10:00:00Z" })).status).toBe(403);
    expect(world.updates).toEqual([]);
  });
});

function ticketRow() {
  return {
    id: 1, title: "Printer", description: "", type: "INCIDENT", status: "OPEN", priority: "MEDIUM", impact: "MEDIUM", urgency: "MEDIUM", source: "API",
    categoryId: null, serviceId: null, catalogItem: null, dueAt: null, resolvedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  };
}
