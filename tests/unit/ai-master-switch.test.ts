import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => store.values[key] ?? null,
  getBoolSetting: async (key: string, fallback = false) => {
    const v = store.values[key];
    return v == null ? fallback : v === "true";
  },
}));

import { aiConfigured, aiEnabled, aiTeaserEnabled } from "@/lib/ai";

beforeEach(() => {
  store.values = {};
});

describe("AI master switch (AI_ENABLED)", () => {
  it("is on by default, so existing installs keep their assistant", async () => {
    store.values = { AI_PROVIDER: "ollama" };
    expect(await aiEnabled()).toBe(true);
    expect(await aiConfigured()).toBe(true);
  });

  it("off disables the assistant whatever the provider, and hides the teaser too", async () => {
    store.values = { AI_ENABLED: "false", AI_PROVIDER: "ollama", AI_TEASER: "true" };
    expect(await aiConfigured()).toBe(false);
    expect(await aiTeaserEnabled()).toBe(false);
  });

  it("the teaser still works while the assistant is on but unconfigured", async () => {
    store.values = { AI_TEASER: "true" };
    expect(await aiConfigured()).toBe(false);
    expect(await aiTeaserEnabled()).toBe(true);
  });
});
