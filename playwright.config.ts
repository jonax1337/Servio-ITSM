import { defineConfig } from "@playwright/test";

const PORT = 3200;

/**
 * Link-integrity crawl against a prebuilt app (`next build` first; CI migrates
 * and seeds a throwaway SQLite DB before). Locally an already running server on
 * the port is reused.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 8 * 60_000,
  fullyParallel: true,
  workers: 4,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
