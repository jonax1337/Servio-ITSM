import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ user: { update: vi.fn() } }));
const writeAudit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ writeAudit }));

import { recordSignIn } from "@/lib/sign-in-record";

beforeEach(() => vi.resetAllMocks());

describe("recordSignIn", () => {
  it("stamps lastLoginAt and writes a LOGIN audit entry for an SSO sign-in", async () => {
    await recordSignIn({ id: "u1", email: "a@example.com" }, { method: "sso" });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { lastLoginAt: expect.any(Date) } });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", action: "LOGIN", entity: "User", entityId: "u1", summary: "Signed in (a@example.com, SSO)" }),
    );
  });

  it("writes the same entry shape for a password sign-in, with the throttled IP", async () => {
    await recordSignIn({ id: "u1", email: "a@example.com" }, { method: "password", ip: "10.0.0.1" });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN", summary: "Signed in (a@example.com)", ip: "10.0.0.1" }),
    );
  });
});
