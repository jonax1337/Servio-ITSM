import { expect, test, type Page } from "@playwright/test";
import { crawl, type Failure } from "./support/crawl";

const PASSWORD = "servio123";
const MAX_PAGES_PER_ROLE = 250;
const MAX_PAGES_PER_SHAPE = 3;

/** Seed users (prisma/seed.ts), one per role, with the page each role lands on. */
const ROLES = [
  { role: "ADMIN", email: "admin@servio.dev", home: "/" },
  { role: "MANAGER", email: "mara@servio.dev", home: "/" },
  { role: "AGENT", email: "sam@servio.dev", home: "/" },
  { role: "USER", email: "liam@servio.dev", home: "/portal" },
] as const;

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function failureTable(role: string, failures: Failure[]): string {
  const rows = failures.map((f) => `${role.padEnd(8)} ${f.source.padEnd(32)} ${f.target.padEnd(40)} ${f.reason}`);
  return ["ROLE     SOURCE PAGE                      TARGET                                   REASON", ...rows].join("\n");
}

for (const { role, email, home } of ROLES) {
  test(`${role}: every linked page loads without errors`, async ({ page }) => {
    await logIn(page, email);
    const { visited, failures } = await crawl({
      page,
      start: home,
      maxPages: MAX_PAGES_PER_ROLE,
      maxPerShape: MAX_PAGES_PER_SHAPE,
    });
    console.log(`${role}: visited ${visited} pages, ${failures.length} broken`);
    expect(failures.length, `\n${failureTable(role, failures)}\n`).toBe(0);
  });
}
