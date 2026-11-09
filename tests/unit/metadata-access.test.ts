import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { isActive: boolean; role: string } | null }));
const ORDER = ["USER", "AGENT", "MANAGER", "ADMIN"];
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => session.user,
  hasRole: (role: string, min: string) => ORDER.indexOf(role) >= ORDER.indexOf(min),
}));

import { canReadConsoleTitle } from "@/lib/metadata-access";

beforeEach(() => {
  session.user = null;
});

describe("canReadConsoleTitle (generateMetadata of console detail pages)", () => {
  it("refuses signed-out visitors and plain end users", async () => {
    expect(await canReadConsoleTitle()).toBe(false);
    session.user = { isActive: true, role: "USER" };
    expect(await canReadConsoleTitle()).toBe(false);
  });

  it("refuses a deactivated agent", async () => {
    session.user = { isActive: false, role: "AGENT" };
    expect(await canReadConsoleTitle()).toBe(false);
  });

  it("allows agents, and honours a higher minimum role", async () => {
    session.user = { isActive: true, role: "AGENT" };
    expect(await canReadConsoleTitle()).toBe(true);
    expect(await canReadConsoleTitle("MANAGER")).toBe(false);
    session.user = { isActive: true, role: "MANAGER" };
    expect(await canReadConsoleTitle("MANAGER")).toBe(true);
  });
});
