import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit-test config for Servio's DB-free business logic (SLA clock, business
 * hours, search, custom fields, rate limiting, crypto, markdown, guards).
 * The suite deliberately stays off the network, the filesystem beyond the
 * repo, and the database — anything DB-bound is covered by the seeds + build.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The updater suites copy real backup files through temp dirs; alone the
    // slowest takes ~3.5 s, so the 5 s default times out under parallel load.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
