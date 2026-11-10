import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /slas and /business-calendars: the input contract, the MANAGER+ gate, name and import_ref conflicts,
 * idempotent upserts, the refusal to delete a referenced record, and the generated public holidays
 * (region switch, manual override) against an in-memory database.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const world = vi.hoisted(() => ({
  slas: [] as Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any
  calendars: [] as Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any
  holidays: [] as Record<string, any>[], // eslint-disable-line @typescript-eslint/no-explicit-any
  policies: new Set<string>(["pol1"]),
  counts: { tickets: 0, services: 0 },
  next: 1,
  audits: [] as { action: string; entity: string; entityId: string; summary?: string }[],
  role: "MANAGER",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { action: string; entity: string; entityId: string; summary?: string }) => { world.audits.push(a); },
}));
vi.mock("@/app/api/v1/_itsm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal: { userId: "mgr", role: world.role, tokenId: "t", scopes: ["write"] } }),
}));

vi.mock("@/lib/db", () => {
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date) && "in" in v) return (v as { in: unknown[] }).in.includes(row[k]);
      return same(row[k], v);
    });
  const unique = (rows: Row[], data: Row, columns: string[]) => {
    for (const c of columns) {
      if (data[c] != null && rows.some((r) => r[c] === data[c])) throw Object.assign(new Error("unique"), { code: "P2002", meta: { target: [c] } });
    }
  };
  const calendarView = (c: Row | null) =>
    c && {
      ...c,
      holidays: world.holidays.filter((h) => h.calendarId === c.id).sort((a, b) => a.date.getTime() - b.date.getTime()),
      _count: { slas: world.slas.filter((s) => s.businessCalendarId === c.id).length },
    };
  const slaView = (s: Row | null) => s && { ...s, businessCalendar: world.calendars.find((c) => c.id === s.businessCalendarId) ?? null };

  const db: Row = {
    sLA: {
      findUnique: async ({ where }: { where: Row }) => slaView(world.slas.find((s) => matches(s, where)) ?? null),
      findMany: async () => world.slas.map(slaView),
      create: async ({ data }: { data: Row }) => {
        unique(world.slas, data, ["name", "importRef"]);
        const row = { id: `s${world.next++}`, description: null, priority: null, isActive: true, businessCalendarId: null, escalationPolicyId: null, importRef: null, ...data };
        world.slas.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = world.slas.find((s) => matches(s, where))!;
        unique(world.slas.filter((s) => s !== row), data, ["name", "importRef"]);
        return Object.assign(row, data);
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = world.slas.length;
        world.slas = world.slas.filter((s) => !matches(s, where));
        return { count: before - world.slas.length };
      },
      count: async ({ where }: { where: Row }) => world.slas.filter((s) => matches(s, where)).length,
    },
    escalationPolicy: { findUnique: async ({ where }: { where: { id: string } }) => (world.policies.has(where.id) ? { id: where.id } : null) },
    ticket: { count: async () => world.counts.tickets },
    service: { count: async () => world.counts.services },
    businessCalendar: {
      findUnique: async ({ where }: { where: Row }) => calendarView(world.calendars.find((c) => matches(c, where)) ?? null),
      findMany: async () => world.calendars.map(calendarView),
      create: async ({ data }: { data: Row }) => {
        unique(world.calendars, data, ["importRef"]);
        const { holidays, ...rest } = data;
        const row = { id: `c${world.next++}`, timezone: "UTC", weeklyHours: "{}", holidayRegion: null, importRef: null, ...rest };
        world.calendars.push(row);
        for (const h of holidays?.create ?? []) world.holidays.push({ id: `h${world.next++}`, calendarId: row.id, generated: false, ...h });
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = world.calendars.find((c) => matches(c, where))!;
        unique(world.calendars.filter((c) => c !== row), data, ["importRef"]);
        return Object.assign(row, data);
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const gone = world.calendars.filter((c) => matches(c, where)).map((c) => c.id);
        world.calendars = world.calendars.filter((c) => !gone.includes(c.id));
        world.holidays = world.holidays.filter((h) => !gone.includes(h.calendarId));
        return { count: gone.length };
      },
    },
    holiday: {
      findFirst: async ({ where }: { where: Row }) => {
        const h = world.holidays.find((x) => matches(x, where));
        return h ? { ...h, calendar: world.calendars.find((c) => c.id === h.calendarId) } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: Row }) => world.holidays.find((h) => matches(h, where))!,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `h${world.next++}`, generated: false, ...data };
        world.holidays.push(row);
        return row;
      },
      createMany: async ({ data }: { data: Row[] }) => {
        for (const d of data) world.holidays.push({ id: `h${world.next++}`, generated: false, ...d });
        return { count: data.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(world.holidays.find((h) => matches(h, where))!, data),
      deleteMany: async ({ where }: { where: Row }) => {
        const before = world.holidays.length;
        world.holidays = world.holidays.filter((h) => !matches(h, where));
        return { count: before - world.holidays.length };
      },
    },
    $transaction: async (arg: unknown) => (typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[])),
  };
  return { db };
});

import { GET as listSlas, POST as createSla } from "@/app/api/v1/slas/route";
import { DELETE as deleteSla, PATCH as patchSla } from "@/app/api/v1/slas/[id]/route";
import { PUT as putSla } from "@/app/api/v1/slas/ref/[ref]/route";
import { GET as listCalendars, POST as createCalendar } from "@/app/api/v1/business-calendars/route";
import { DELETE as deleteCalendar, PATCH as patchCalendar } from "@/app/api/v1/business-calendars/[id]/route";
import { PUT as putCalendar } from "@/app/api/v1/business-calendars/ref/[ref]/route";
import { POST as addHoliday } from "@/app/api/v1/business-calendars/[id]/holidays/route";
import { DELETE as removeHoliday } from "@/app/api/v1/business-calendars/[id]/holidays/[holidayId]/route";
import { slaCreateSchema, slaData, slaPatchSchema, slaUpsertSchema } from "@/lib/api-sla-input";
import { calendarCreateSchema, calendarData, canonicalWeeklyHours, isValidTimezone } from "@/lib/api-calendar-input";
import { calendarInUseRefusal, nonEmptyReferences, slaInUseRefusal } from "@/lib/sla-rules";

const req = (method: string, body?: unknown) =>
  new Request("http://x/api/v1/x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const HOURS = { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]] };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  world.slas = [];
  world.calendars = [];
  world.holidays = [];
  world.counts = { tickets: 0, services: 0 };
  world.next = 1;
  world.audits = [];
  world.role = "MANAGER";
});

describe("SLA input schemas", () => {
  it("require name and both targets on create and reject unknown fields", () => {
    expect(slaCreateSchema.safeParse({ name: "Gold" }).success).toBe(false);
    expect(slaCreateSchema.safeParse({ name: "Gold", response_mins: 30, resolve_mins: 240 }).success).toBe(true);
    expect(slaCreateSchema.safeParse({ name: "Gold", response_mins: 30, resolve_mins: 240, nope: 1 }).success).toBe(false);
  });

  it("validate minutes, priority, import_ref and the calendar keys", () => {
    const base = { name: "Gold", response_mins: 30, resolve_mins: 240 };
    for (const bad of [{ response_mins: 0 }, { resolve_mins: 1.5 }, { priority: "URGENT" }, { import_ref: "has space" }, { business_calendar_id: "c", business_calendar_ref: "x" }]) {
      expect(slaCreateSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
    expect(slaCreateSchema.safeParse({ ...base, priority: "HIGH", business_calendar_ref: "cal:office", escalation_policy_id: "p" }).success).toBe(true);
  });

  it("patch and upsert need a field; null clears the nullable ones; absent keys stay untouched", () => {
    expect(slaPatchSchema.safeParse({}).success).toBe(false);
    expect(slaUpsertSchema.safeParse({}).success).toBe(false);
    expect(slaPatchSchema.safeParse({ description: null, priority: null, business_calendar_id: null, escalation_policy_id: null, import_ref: null }).success).toBe(true);
    expect(slaData({ response_mins: 15, is_active: false, description: "" })).toEqual({ responseMins: 15, isActive: false, description: null });
    expect(slaData({})).toEqual({});
  });
});

describe("calendar input schemas", () => {
  it("require name and weekly_hours on create", () => {
    expect(calendarCreateSchema.safeParse({ name: "Office" }).success).toBe(false);
    expect(calendarCreateSchema.safeParse({ name: "Office", weekly_hours: HOURS }).success).toBe(true);
  });

  it("validate windows, weekday keys, timezone, region and holidays", () => {
    const base = { name: "Office", weekly_hours: HOURS };
    const bad = [
      { weekly_hours: { mon: [["17:00", "09:00"]] } },
      { weekly_hours: { mon: [["9am", "5pm"]] } },
      { weekly_hours: { monday: [["09:00", "17:00"]] } },
      { timezone: "Mars/Olympus" },
      { holiday_region: "DE-XX" },
      { holidays: [{ date: "2026-02-30", name: "Nope" }] },
      { holidays: [{ date: "2026-12-24", name: "A" }, { date: "2026-12-24", name: "B" }] },
    ];
    for (const b of bad) expect(calendarCreateSchema.safeParse({ ...base, ...b }).success).toBe(false);
    expect(calendarCreateSchema.safeParse({ ...base, timezone: "Europe/Berlin", holiday_region: "DE-BE", holidays: [{ date: "2026-12-24", name: "Heiligabend" }] }).success).toBe(true);
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Nope")).toBe(false);
  });

  it("stores the hours canonically so equal hours compare equal", () => {
    expect(canonicalWeeklyHours({ tue: [["09:00", "17:00"]], mon: [["13:00", "17:00"], ["09:00", "12:00"]] })).toBe(
      canonicalWeeklyHours({ mon: [["09:00", "12:00"], ["13:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [] }),
    );
    expect(calendarData({ holiday_region: null })).toEqual({ holidayRegion: null });
  });
});

describe("the delete refusals", () => {
  it("are null when nothing points at the record and list only the kinds that count", () => {
    expect(slaInUseRefusal(nonEmptyReferences({ tickets: 0, services: 0 }))).toBeNull();
    expect(slaInUseRefusal(nonEmptyReferences({ tickets: 3, services: 0 }))).toMatchObject({ code: "SLA_IN_USE", references: { tickets: 3 } });
    expect(calendarInUseRefusal(nonEmptyReferences({ slas: 2 }))).toMatchObject({ code: "CALENDAR_IN_USE", references: { slas: 2 } });
  });
});

describe("/slas", () => {
  it("creates an SLA (201), resolves the calendar by its reference and audits", async () => {
    await createCalendar(req("POST", { name: "Office", weekly_hours: HOURS, import_ref: "cal:office" }));
    world.audits = [];
    const res = await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240, priority: "HIGH", business_calendar_ref: "cal:office", import_ref: "sla:gold" }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ name: "Gold", response_mins: 30, resolve_mins: 240, priority: "HIGH", is_active: true, import_ref: "sla:gold", business_calendar: { name: "Office" } });
    expect(data.business_calendar_id).toBe(world.calendars[0].id);
    expect(world.audits).toEqual([expect.objectContaining({ action: "CREATE", entity: "SLA", entityId: data.id })]);
  });

  it("is refused for an agent token and touches nothing", async () => {
    world.role = "AGENT";
    expect((await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240 }))).status).toBe(403);
    expect((await deleteSla(req("DELETE"), params({ id: "s1" }))).status).toBe(403);
    expect(world.slas).toEqual([]);
  });

  it("answers 409 with the existing id for a duplicate name or reference, and 422 for unknown links", async () => {
    const first = await (await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240, import_ref: "sla:gold" }))).json();
    const dupName = await createSla(req("POST", { name: "Gold", response_mins: 1, resolve_mins: 2 }));
    expect(dupName.status).toBe(409);
    expect((await dupName.json()).error.details).toEqual({ id: first.data.id });
    expect((await createSla(req("POST", { name: "Silver", response_mins: 1, resolve_mins: 2, import_ref: "sla:gold" }))).status).toBe(409);
    expect((await createSla(req("POST", { name: "Silver", response_mins: 1, resolve_mins: 2, business_calendar_id: "nope" }))).status).toBe(422);
    expect((await createSla(req("POST", { name: "Silver", response_mins: 1, resolve_mins: 2, business_calendar_ref: "nope" }))).status).toBe(422);
    expect((await createSla(req("POST", { name: "Silver", response_mins: 1, resolve_mins: 2, escalation_policy_id: "nope" }))).status).toBe(422);
  });

  it("PATCH writes only what changed and an unchanged body writes no audit row", async () => {
    const { data } = await (await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240 }))).json();
    world.audits = [];
    const same = await patchSla(req("PATCH", { response_mins: 30 }), params({ id: data.id }));
    expect((await same.json()).meta.changed).toEqual([]);
    expect(world.audits).toEqual([]);
    const changed = await patchSla(req("PATCH", { response_mins: 15, is_active: false, priority: "CRITICAL" }), params({ id: data.id }));
    const body = await changed.json();
    expect(body.meta.changed.sort()).toEqual(["is_active", "priority", "response_mins"]);
    expect(body.data).toMatchObject({ response_mins: 15, is_active: false, priority: "CRITICAL" });
    expect(world.audits).toHaveLength(1);
    expect((await patchSla(req("PATCH", { priority: null }), params({ id: data.id }))).status).toBe(200);
    expect((await patchSla(req("PATCH", { name: "x" }), params({ id: "missing" }))).status).toBe(404);
  });

  it("DELETE is refused with the counts while tickets or services use the SLA, and deletes otherwise", async () => {
    const { data } = await (await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240 }))).json();
    world.counts = { tickets: 4, services: 1 };
    const refused = await deleteSla(req("DELETE"), params({ id: data.id }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.details).toMatchObject({ code: "SLA_IN_USE", references: { tickets: 4, services: 1 } });
    expect(world.slas).toHaveLength(1);

    world.counts = { tickets: 0, services: 0 };
    world.audits = [];
    const done = await deleteSla(req("DELETE"), params({ id: data.id }));
    expect((await done.json()).data).toEqual({ id: data.id, deleted: true });
    expect(world.audits).toEqual([expect.objectContaining({ action: "DELETE", entity: "SLA" })]);
  });

  it("PUT upserts by reference: 201 when new, 200 when unchanged without an audit row, and needs the targets to create", async () => {
    const put = (body: unknown) => putSla(req("PUT", body), params({ ref: "sla:gold" }));
    const missing = await put({ name: "Gold" });
    expect(missing.status).toBe(422);
    expect((await missing.json()).error.details).toEqual({ response_mins: ["Required to create a new SLA"], resolve_mins: ["Required to create a new SLA"] });

    const created = await put({ name: "Gold", response_mins: 30, resolve_mins: 240 });
    expect(created.status).toBe(201);
    expect((await created.json()).meta.created).toBe(true);

    world.audits = [];
    const again = await put({ name: "Gold", response_mins: 30, resolve_mins: 240 });
    expect(again.status).toBe(200);
    expect((await again.json()).meta).toEqual({ created: false, changed: [] });
    expect(world.audits).toEqual([]);

    const changed = await (await put({ resolve_mins: 120 })).json();
    expect(changed.meta.changed).toEqual(["resolve_mins"]);
    expect(world.slas).toHaveLength(1);
  });

  it("lists SLAs", async () => {
    await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240 }));
    const rows = (await (await listSlas(req("GET"))).json()).data;
    expect(rows).toHaveLength(1);
  });
});

describe("/business-calendars", () => {
  const office = { name: "Office", timezone: "Europe/Berlin", weekly_hours: HOURS, holiday_region: "DE-BE" };
  const holidaysOf = (c: { holidays: { date: string; name: string; generated: boolean }[] }, generated: boolean) =>
    c.holidays.filter((h) => h.generated === generated);

  it("creates a calendar with generated holidays for this and the next year, marked as generated", async () => {
    const res = await createCalendar(req("POST", { ...office, holidays: [{ date: "2026-12-24", name: "Heiligabend" }] }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.holiday_region).toBe("DE-BE");
    expect(data.weekly_hours.mon).toEqual([["09:00", "17:00"]]);
    expect(data.weekly_hours.sun).toEqual([]);
    const generated = holidaysOf(data, true);
    expect(generated.filter((h) => h.date.startsWith("2026"))).toHaveLength(10);
    expect(generated.filter((h) => h.date.startsWith("2027"))).toHaveLength(10);
    expect(generated.some((h) => h.date.startsWith("2028"))).toBe(false);
    expect(generated.find((h) => h.name === "Internationaler Frauentag" && h.date === "2026-03-08")).toBeTruthy();
    expect(holidaysOf(data, false)).toEqual([expect.objectContaining({ date: "2026-12-24", name: "Heiligabend", generated: false })]);
    expect(data.holidays.map((h: { date: string }) => h.date)).toEqual([...data.holidays.map((h: { date: string }) => h.date)].sort());
  });

  it("lets a manual holiday on the same date win over the generated one", async () => {
    const { data } = await (await createCalendar(req("POST", { ...office, holidays: [{ date: "2026-12-25", name: "Betriebsruhe" }] }))).json();
    const onDay = data.holidays.filter((h: { date: string }) => h.date === "2026-12-25");
    expect(onDay).toEqual([expect.objectContaining({ name: "Betriebsruhe", generated: false })]);
  });

  it("a manual holiday added later replaces the generated one, and removing it brings the generated one back", async () => {
    const { data } = await (await createCalendar(req("POST", office))).json();
    const added = await addHoliday(req("POST", { date: "2026-05-01", name: "Maifeier" }), params({ id: data.id }));
    expect(added.status).toBe(201);
    const holiday = (await added.json()).data;
    expect(world.holidays.filter((h) => h.date.toISOString().startsWith("2026-05-01"))).toHaveLength(1);

    const again = await addHoliday(req("POST", { date: "2026-05-01", name: "Maifeier" }), params({ id: data.id }));
    expect(again.status).toBe(200);
    expect((await again.json()).meta.created).toBe(false);

    await removeHoliday(req("DELETE"), params({ id: data.id, holidayId: holiday.id }));
    const back = world.holidays.filter((h) => h.date.toISOString().startsWith("2026-05-01"));
    expect(back).toEqual([expect.objectContaining({ name: "Tag der Arbeit", generated: true })]);
  });

  it("refuses to remove a generated holiday on its own", async () => {
    const { data } = await (await createCalendar(req("POST", office))).json();
    const generated = data.holidays[0];
    const res = await removeHoliday(req("DELETE"), params({ id: data.id, holidayId: generated.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.code).toBe("HOLIDAY_GENERATED");
    expect((await removeHoliday(req("DELETE"), params({ id: data.id, holidayId: "nope" }))).status).toBe(404);
  });

  it("switching the region regenerates; null removes the generated ones and keeps the manual ones", async () => {
    const { data } = await (await createCalendar(req("POST", { ...office, holidays: [{ date: "2026-12-24", name: "Heiligabend" }] }))).json();
    const toBavaria = await (await patchCalendar(req("PATCH", { holiday_region: "DE-BY" }), params({ id: data.id }))).json();
    expect(toBavaria.meta.changed).toEqual(["holiday_region"]);
    const names = new Set(toBavaria.data.holidays.map((h: { name: string }) => h.name));
    expect(names.has("Internationaler Frauentag")).toBe(false);
    expect(names.has("Fronleichnam")).toBe(true);

    const off = await (await patchCalendar(req("PATCH", { holiday_region: null }), params({ id: data.id }))).json();
    expect(off.data.holidays).toEqual([expect.objectContaining({ name: "Heiligabend", generated: false })]);
  });

  it("PATCH holidays replaces the manual set only", async () => {
    const { data } = await (await createCalendar(req("POST", { ...office, holidays: [{ date: "2026-12-24", name: "Heiligabend" }, { date: "2026-12-31", name: "Silvester" }] }))).json();
    const res = await (await patchCalendar(req("PATCH", { holidays: [{ date: "2026-12-31", name: "Silvester (frei)" }] }), params({ id: data.id }))).json();
    expect(res.meta.changed).toEqual(["holidays"]);
    expect(holidaysOf(res.data, false)).toEqual([expect.objectContaining({ date: "2026-12-31", name: "Silvester (frei)" })]);
    expect(holidaysOf(res.data, true).length).toBeGreaterThan(10);
  });

  it("PUT upserts idempotently: a repeated body writes nothing and no audit row", async () => {
    const put = (body: unknown) => putCalendar(req("PUT", body), params({ ref: "hr:office" }));
    const missing = await put({ name: "Office" });
    expect(missing.status).toBe(422);
    const created = await put({ ...office, holidays: [{ date: "2026-12-24", name: "Heiligabend" }] });
    expect(created.status).toBe(201);
    const rowsBefore = world.holidays.length;
    world.audits = [];
    const again = await put({ ...office, weekly_hours: { tue: [["09:00", "17:00"]], mon: [["09:00", "17:00"]] }, holidays: [{ date: "2026-12-24", name: "Heiligabend" }] });
    expect(again.status).toBe(200);
    expect((await again.json()).meta).toEqual({ created: false, changed: [] });
    expect(world.audits).toEqual([]);
    expect(world.holidays).toHaveLength(rowsBefore);
    const changed = await (await put({ timezone: "Europe/Vienna" })).json();
    expect(changed.meta.changed).toEqual(["timezone"]);
  });

  it("is refused for an agent token and rejects an unknown timezone", async () => {
    world.role = "AGENT";
    expect((await createCalendar(req("POST", office))).status).toBe(403);
    world.role = "MANAGER";
    expect((await createCalendar(req("POST", { ...office, timezone: "Mars/Olympus" }))).status).toBe(422);
    expect(world.calendars).toEqual([]);
  });

  it("DELETE is refused with the SLA count while SLAs use the calendar, and takes the holidays with it otherwise", async () => {
    const { data } = await (await createCalendar(req("POST", { ...office, import_ref: "hr:office" }))).json();
    await createSla(req("POST", { name: "Gold", response_mins: 30, resolve_mins: 240, business_calendar_id: data.id }));
    const refused = await deleteCalendar(req("DELETE"), params({ id: data.id }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.details).toMatchObject({ code: "CALENDAR_IN_USE", references: { slas: 1 } });

    world.slas = [];
    const done = await deleteCalendar(req("DELETE"), params({ id: data.id }));
    expect((await done.json()).data.deleted).toBe(true);
    expect(world.holidays).toEqual([]);
  });

  it("lists calendars with sla_count", async () => {
    await createCalendar(req("POST", office));
    const rows = (await (await listCalendars(req("GET"))).json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0].sla_count).toBe(0);
  });
});
