import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the two address tables, enough for the lookups.
const state = vi.hoisted(() => ({
  users: [] as { id: string; email: string; name: string }[],
  secondary: [] as { userId: string; email: string; createdAt: Date }[],
}));

vi.mock("@/lib/db", () => {
  const pick = <T extends Record<string, unknown>>(row: T | undefined, select?: Record<string, unknown>) =>
    row ? (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row) : null;
  const user = {
    findUnique: async ({ where, select }: { where: { email?: string; id?: string }; select?: Record<string, unknown> }) =>
      pick(state.users.find((u) => (where.email ? u.email === where.email : u.id === where.id)), select),
  };
  const userEmail = {
    findUnique: async ({ where, select }: { where: { email: string }; select?: Record<string, unknown> }) =>
      pick(state.secondary.find((e) => e.email === where.email), select),
    findMany: async ({ where }: { where: { userId: string } }) => state.secondary.filter((e) => e.userId === where.userId),
    deleteMany: ({ where }: { where: { userId: string; email: { in: string[] } } }) => ({
      run: () => {
        state.secondary = state.secondary.filter((e) => !(e.userId === where.userId && where.email.in.includes(e.email)));
      },
    }),
    create: ({ data }: { data: { userId: string; email: string } }) => ({
      run: () => {
        state.secondary.push({ ...data, createdAt: new Date() });
      },
    }),
  };
  const $transaction = async (ops: { run: () => void }[]) => ops.forEach((op) => op.run());
  return { db: { user, userEmail, $transaction } };
});

import { emailOwnerId, emailTakenByOther, findUserByAnyEmail, replaceSecondaryEmails } from "@/lib/user-emails";
import { normalizeSecondaryEmails, splitEmailList } from "@/lib/user-email-rules";

beforeEach(() => {
  state.users = [
    { id: "u1", email: "jane@corp.example", name: "Jane" },
    { id: "u2", email: "max@corp.example", name: "Max" },
  ];
  state.secondary = [{ userId: "u1", email: "jane.private@mail.example", createdAt: new Date(0) }];
});

describe("findUserByAnyEmail (inbound sender matching)", () => {
  it("finds a person by the primary address", async () => {
    expect(await findUserByAnyEmail("jane@corp.example", { id: true })).toEqual({ id: "u1" });
  });

  it("finds a person by a secondary address, case-insensitively", async () => {
    expect(await findUserByAnyEmail(" Jane.Private@Mail.example ", { id: true, name: true })).toEqual({ id: "u1", name: "Jane" });
  });

  it("returns null for an unknown address", async () => {
    expect(await findUserByAnyEmail("nobody@mail.example", { id: true })).toBeNull();
  });
});

describe("uniqueness across primary and secondary addresses", () => {
  it("knows who owns an address", async () => {
    expect(await emailOwnerId("max@corp.example")).toBe("u2");
    expect(await emailOwnerId("jane.private@mail.example")).toBe("u1");
    expect(await emailOwnerId("free@mail.example")).toBeNull();
  });

  it("treats a person's own address as free for that person only", async () => {
    expect(await emailTakenByOther("jane.private@mail.example", "u1")).toBe(false);
    expect(await emailTakenByOther("jane.private@mail.example", "u2")).toBe(true);
    expect(await emailTakenByOther("jane@corp.example")).toBe(true);
  });

  it("refuses another person's primary or secondary address", async () => {
    expect(await replaceSecondaryEmails("u2", ["jane@corp.example"])).toEqual({ ok: false, error: "A person with this email already exists.", email: "jane@corp.example" });
    expect(await replaceSecondaryEmails("u2", ["jane.private@mail.example"])).toMatchObject({ ok: false });
  });

  it("replaces the list and reports what changed", async () => {
    expect(await replaceSecondaryEmails("u1", ["jane.alias@corp.example"])).toEqual({
      ok: true,
      added: ["jane.alias@corp.example"],
      removed: ["jane.private@mail.example"],
    });
    expect(state.secondary.map((e) => e.email)).toEqual(["jane.alias@corp.example"]);
  });
});

describe("replaceSecondaryEmails inside the caller's transaction", () => {
  // The transaction client is a separate object: every read and write must go through it (a second
  // connection would wait for the open transaction), and nothing may open a nested transaction.
  function fakeTx(owner: Record<string, string> = {}) {
    const writes: string[] = [];
    const tx = {
      user: { findUnique: async () => null },
      userEmail: {
        findUnique: async ({ where }: { where: { email: string } }) => (owner[where.email] ? { userId: owner[where.email] } : null),
        findMany: async () => [{ email: "jane.private@mail.example" }],
        deleteMany: async ({ where }: { where: { email: { in: string[] } } }) => void writes.push(`delete ${where.email.in.join(",")}`),
        create: async ({ data }: { data: { email: string } }) => void writes.push(`create ${data.email}`),
      },
    };
    return { tx: tx as unknown as Parameters<typeof replaceSecondaryEmails>[2], writes };
  }

  it("writes on the transaction client", async () => {
    const { tx, writes } = fakeTx();
    const r = await replaceSecondaryEmails("u1", ["jane.alias@corp.example"], tx);
    expect(r).toEqual({ ok: true, added: ["jane.alias@corp.example"], removed: ["jane.private@mail.example"] });
    expect(writes).toEqual(["delete jane.private@mail.example", "create jane.alias@corp.example"]);
    expect(state.secondary.map((e) => e.email)).toEqual(["jane.private@mail.example"]);
  });

  it("checks uniqueness on the transaction client and writes nothing on a clash", async () => {
    const { tx, writes } = fakeTx({ "taken@mail.example": "u2" });
    expect(await replaceSecondaryEmails("u1", ["taken@mail.example"], tx)).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });
});

describe("normalizeSecondaryEmails", () => {
  it("normalizes, de-duplicates and drops blanks", () => {
    expect(normalizeSecondaryEmails(["A@x.example", " a@x.example ", "", "b@y.example"], "me@x.example")).toEqual({
      ok: true,
      emails: ["a@x.example", "b@y.example"],
    });
  });

  it("rejects malformed addresses, the primary address and too many entries", () => {
    expect(normalizeSecondaryEmails(["nope"], "me@x.example")).toEqual({ ok: false, error: '"nope" is not a valid email address.' });
    expect(normalizeSecondaryEmails(["ME@x.example"], "me@x.example")).toEqual({
      ok: false,
      error: "The primary address cannot also be a secondary address.",
    });
    const many = Array.from({ length: 11 }, (_, i) => `a${i}@x.example`);
    expect(normalizeSecondaryEmails(many, "me@x.example")).toEqual({ ok: false, error: "A person can have at most 10 secondary addresses." });
  });

  it("splits a textarea list", () => {
    expect(splitEmailList("a@x.example\nb@x.example, c@x.example;d@x.example")).toEqual(["a@x.example", "b@x.example", "c@x.example", "d@x.example"]);
  });
});
