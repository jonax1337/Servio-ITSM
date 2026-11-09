import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter } from "next-auth/adapters";

const m = vi.hoisted(() => ({ owner: null as string | null, audits: [] as unknown[] }));
vi.mock("@/lib/user-emails", () => ({ emailOwnerId: async () => m.owner }));
vi.mock("@/lib/audit", () => ({ writeAudit: async (e: unknown) => void m.audits.push(e) }));

import { guardAdapter } from "@/lib/auth-adapter-guard";

const created = vi.fn(async (d: { email: string }) => ({ id: "new", emailVerified: null, ...d }));
const adapter = guardAdapter({ createUser: created } as unknown as Adapter);

beforeEach(() => {
  m.owner = null;
  m.audits = [];
  created.mockClear();
});

describe("guardAdapter", () => {
  it("creates a user whose address is free", async () => {
    await adapter.createUser!({ id: "x", email: "new@corp.example", emailVerified: null });
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("refuses an address that is some person's secondary (or primary) address, and audits it", async () => {
    m.owner = "u1";
    await expect(adapter.createUser!({ id: "x", email: "alias@corp.example", emailVerified: null })).rejects.toThrow("EmailInUse");
    expect(created).not.toHaveBeenCalled();
    expect(m.audits).toHaveLength(1);
  });
});
