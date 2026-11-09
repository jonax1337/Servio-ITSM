import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncSource } from "@prisma/client";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  userEmail: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/user-emails", () => ({ releaseOwnSecondary: vi.fn() }));

import { changedFields, importUsers } from "@/lib/connectors/import";
import { SyncLog } from "@/lib/connectors/types";

const source = { id: "src1" } as SyncSource;
const stored = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  jobTitle: "Engineer",
  phone: null,
  department: "R&D",
  isActive: true,
  syncSourceId: "src1",
  externalId: "ext-1",
};
const record = { externalId: "ext-1", email: "ada@example.com", name: "Ada Lovelace", jobTitle: "Engineer", phone: null, department: "R&D" };

beforeEach(() => {
  vi.resetAllMocks();
  db.userEmail.findUnique.mockResolvedValue(null);
});

describe("changedFields", () => {
  it("lists only differing fields; undefined means untouched, null is a real value", () => {
    expect(changedFields({ a: 1, b: null, c: "x" }, { a: 1, b: null, c: "y", d: undefined })).toEqual({ c: "y" });
    expect(changedFields({ phone: "123" }, { phone: null })).toEqual({ phone: null });
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual({});
  });
});

describe("importUsers on an unchanged directory", () => {
  it("neither writes nor counts an account that already matches", async () => {
    db.user.findUnique.mockResolvedValue(stored);
    const log = new SyncLog();
    await importUsers(source, [record], false, log);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(log).toMatchObject({ created: 0, updated: 0, unchanged: 1, failed: 0 });
    expect(log.status()).toBe("SUCCESS");
    expect(log.toString()).toContain("1 unchanged");
  });

  it("writes only the changed fields and counts the account as updated", async () => {
    db.user.findUnique.mockResolvedValue(stored);
    const log = new SyncLog();
    await importUsers(source, [{ ...record, jobTitle: "Lead" }], false, log);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { jobTitle: "Lead" } });
    expect(log).toMatchObject({ updated: 1, unchanged: 0 });
  });

  it("reactivates a deactivated account, which is a real change", async () => {
    db.user.findUnique.mockResolvedValue({ ...stored, isActive: false });
    const log = new SyncLog();
    await importUsers(source, [record], false, log);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { isActive: true } });
    expect(log.updated).toBe(1);
  });

  it("an unchanged account next to a failure is a partial run, not a failed one", async () => {
    db.user.findUnique.mockResolvedValue(stored);
    const log = new SyncLog();
    await importUsers(source, [record, { error: "no email", ref: "x" }], false, log);
    expect(log.status()).toBe("PARTIAL");
  });
});
