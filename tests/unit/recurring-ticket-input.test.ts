import { describe, expect, it } from "vitest";
import {
  parseRecurringTicketForm,
  recurrenceChanged,
  recurringTicketCreateForm,
  recurringTicketCreateSchema,
  recurringTicketPatchForm,
  recurringTicketPatchSchema,
  type RecurringTicketRow,
} from "@/lib/recurring-ticket-input";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = {
  name: "Certificate renewal",
  title: "Renew the wildcard certificate",
  description: "Order, install, verify.",
  type: "REQUEST",
  priority: "HIGH",
  impact: "MEDIUM",
  urgency: "MEDIUM",
  requesterId: "u1",
  assigneeId: "none",
  groupId: "g1",
  categoryId: "",
  serviceId: "none",
  frequency: "MONTHLY",
  interval: "1",
  timezone: "Europe/Berlin",
  firstDueAt: "2027-01-31T09:00",
  createBeforeDays: "7",
  isActive: "true",
};

describe("parseRecurringTicketForm", () => {
  it("reads the form, turning 'none' / empty ids into null and the due time into an instant in the zone", () => {
    const res = parseRecurringTicketForm(form(valid));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toMatchObject({
      name: "Certificate renewal",
      requesterId: "u1",
      assigneeId: null,
      groupId: "g1",
      categoryId: null,
      serviceId: null,
      interval: 1,
      createBeforeDays: 7,
      isActive: true,
      importRef: null,
      lastCreatedFor: null,
    });
    expect(res.data.firstDueAt.toISOString()).toBe("2027-01-31T08:00:00.000Z");
  });

  it("accepts an ISO time with offset and drops seconds", () => {
    const res = parseRecurringTicketForm(form({ ...valid, firstDueAt: "2027-01-31T08:00:42Z" }));
    expect(res.success && res.data.firstDueAt.toISOString()).toBe("2027-01-31T08:00:00.000Z");
  });

  it("reports field errors", () => {
    const res = parseRecurringTicketForm(form({ ...valid, title: "x", frequency: "HOURLY", interval: "0" }));
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["frequency", "interval", "title"]);
  });

  it("refuses an unknown zone, a bad due time and a lead time that opens too many occurrences", () => {
    expect(parseRecurringTicketForm(form({ ...valid, timezone: "Mars/Olympus" })).success).toBe(false);
    const bad = parseRecurringTicketForm(form({ ...valid, firstDueAt: "2027-02-30T09:00" }));
    expect(!bad.success && bad.fieldErrors.firstDueAt).toBeTruthy();
    const lead = parseRecurringTicketForm(form({ ...valid, frequency: "DAILY", createBeforeDays: "31" }));
    expect(!lead.success && lead.fieldErrors.createBeforeDays?.[0]).toMatch(/at most 30 days/);
    expect(parseRecurringTicketForm(form({ ...valid, frequency: "WEEKLY", createBeforeDays: "30" })).success).toBe(true);
  });

  it("treats a missing isActive as active and 'false' as paused", () => {
    const { isActive: _omit, ...rest } = valid;
    void _omit;
    const on = parseRecurringTicketForm(form(rest));
    const off = parseRecurringTicketForm(form({ ...valid, isActive: "false" }));
    expect(on.success && on.data.isActive).toBe(true);
    expect(off.success && off.data.isActive).toBe(false);
  });
});

describe("recurrenceChanged", () => {
  const base = { frequency: "MONTHLY", interval: 1, timezone: "UTC", firstDueAt: new Date("2027-01-01T09:00:00Z"), createBeforeDays: 0 };
  it("is false for an identical recurrence and true when any recurrence field moves", () => {
    expect(recurrenceChanged(base, { ...base, firstDueAt: new Date(base.firstDueAt) })).toBe(false);
    expect(recurrenceChanged(base, { ...base, interval: 2 })).toBe(true);
    expect(recurrenceChanged(base, { ...base, createBeforeDays: 3 })).toBe(true);
    expect(recurrenceChanged(base, { ...base, timezone: "Europe/Berlin" })).toBe(true);
  });
});

describe("REST bodies", () => {
  it("fills create defaults and stays strict", () => {
    const ok = recurringTicketCreateSchema.parse({ name: "Backup test", title: "Restore test", frequency: "MONTHLY", first_due_at: "2027-01-10T09:00" });
    expect(ok).toMatchObject({ type: "REQUEST", priority: "MEDIUM", interval: 1, timezone: "UTC", create_before_days: 0, active: true });
    expect(recurringTicketCreateSchema.safeParse({ ...ok, frist_due_at: "x" }).success).toBe(false);
    expect(recurringTicketCreateSchema.safeParse({ ...ok, first_due_at: "next monday" }).success).toBe(false);
    expect(recurringTicketCreateSchema.safeParse({ ...ok, frequency: "HOURLY" }).success).toBe(false);
  });

  it("refuses an empty patch", () => {
    expect(recurringTicketPatchSchema.safeParse({}).success).toBe(false);
    expect(recurringTicketPatchSchema.safeParse({ active: false }).success).toBe(true);
    expect(recurringTicketPatchSchema.safeParse({ titel: "x" }).success).toBe(false);
  });

  it("translates a create body into the console form, defaulting the requester to the token owner", () => {
    const body = recurringTicketCreateSchema.parse({
      name: "Backup test",
      title: "Restore test",
      frequency: "WEEKLY",
      interval: 2,
      timezone: "Europe/Berlin",
      first_due_at: "2027-01-11T09:00",
      create_before_days: 3,
      group_id: "g1",
      import_ref: "glpi:ticketrecurrent:7",
      last_created_for: "2026-12-28T08:00:00Z",
    });
    const res = parseRecurringTicketForm(recurringTicketCreateForm(body, "owner"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toMatchObject({
      requesterId: "owner",
      groupId: "g1",
      assigneeId: null,
      frequency: "WEEKLY",
      interval: 2,
      createBeforeDays: 3,
      importRef: "glpi:ticketrecurrent:7",
    });
    expect(res.data.firstDueAt.toISOString()).toBe("2027-01-11T08:00:00.000Z");
    expect(res.data.lastCreatedFor?.toISOString()).toBe("2026-12-28T08:00:00.000Z");
  });

  const row: RecurringTicketRow = {
    id: "r1",
    name: "Licence review",
    title: "Review licences",
    description: "",
    type: "REQUEST",
    priority: "LOW",
    impact: "LOW",
    urgency: "LOW",
    requesterId: "u1",
    assigneeId: "a1",
    groupId: null,
    categoryId: null,
    serviceId: null,
    frequency: "YEARLY",
    interval: 1,
    timezone: "Europe/Berlin",
    firstDueAt: new Date("2027-03-01T08:00:00Z"), // 09:00 CET
    createBeforeDays: 14,
    isActive: true,
  };

  it("merges a patch over the stored row; null clears an id", () => {
    const body = recurringTicketPatchSchema.parse({ title: "Review all licences", assignee_id: null, active: false });
    const res = parseRecurringTicketForm(recurringTicketPatchForm(row, body));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toMatchObject({ title: "Review all licences", name: "Licence review", assigneeId: null, requesterId: "u1", isActive: false, createBeforeDays: 14 });
    expect(res.data.firstDueAt.toISOString()).toBe("2027-03-01T08:00:00.000Z");
  });

  it("keeps the wall-clock due time when only the zone changes", () => {
    const body = recurringTicketPatchSchema.parse({ timezone: "UTC" });
    const res = parseRecurringTicketForm(recurringTicketPatchForm(row, body));
    expect(res.success && res.data.firstDueAt.toISOString()).toBe("2027-03-01T09:00:00.000Z");
  });
});
