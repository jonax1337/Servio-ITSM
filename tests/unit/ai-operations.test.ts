import { describe, expect, it } from "vitest";
import { filterOperationsForRole } from "@/lib/ai-operations/availability";
import type { AiOperation, AiOpChatScope } from "@/lib/ai-operations/types";

/**
 * The GENERAL/ADMIN chat-scope toggle was removed from the UI; adminOnly ops
 * are gated per-operation by the acting user's ROLE alone. These tests pin
 * that contract (and the minRole tiers) so the old scope gate can't silently
 * come back and make admin ops unreachable again.
 */

const op = (over: Partial<AiOperation>): AiOperation => ({
  id: "x",
  group: "G",
  kind: "write",
  minRole: "AGENT",
  description: "",
  input: {} as AiOperation["input"],
  run: async () => ({ ok: true, summary: "" }),
  ...over,
});

const FIXTURES: AiOperation[] = [
  op({ id: "ticket.create", minRole: "AGENT" }),
  op({ id: "sla.create", minRole: "MANAGER" }),
  op({ id: "setting.update", minRole: "ADMIN", adminOnly: true }),
];

describe("filterOperationsForRole (role-only gating)", () => {
  it("offers adminOnly ops to an ADMIN in a GENERAL chat", () => {
    const ids = filterOperationsForRole(FIXTURES, "ADMIN", "GENERAL").map((o) => o.id);
    expect(ids).toContain("setting.update");
  });

  it("never offers adminOnly ops to a non-admin, in ANY scope", () => {
    for (const scope of ["GENERAL", "ADMIN"] as AiOpChatScope[]) {
      expect(filterOperationsForRole(FIXTURES, "MANAGER", scope).some((o) => o.adminOnly)).toBe(false);
    }
  });

  it("tiers regular ops by minRole", () => {
    const agent = filterOperationsForRole(FIXTURES, "AGENT", "GENERAL").map((o) => o.id);
    const manager = filterOperationsForRole(FIXTURES, "MANAGER", "GENERAL").map((o) => o.id);
    expect(agent).toEqual(["ticket.create"]);
    expect(manager).toEqual(["ticket.create", "sla.create"]);
  });

  it("an unknown role gets nothing", () => {
    expect(filterOperationsForRole(FIXTURES, "USER", "GENERAL")).toEqual([]);
    expect(filterOperationsForRole(FIXTURES, "bogus", "GENERAL")).toEqual([]);
  });
});
