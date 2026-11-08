import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { crawl, type Failure } from "./support/crawl";

/**
 * German UI (#63): the sign-in language switch, and a link crawl of the console and the
 * portal for users whose `User.locale` is "de" (set for the test, then back to "auto").
 * Uses seed users the role crawl in links.spec.ts does not log in as, so the specs can run
 * in parallel.
 */
const PASSWORD = "servio123";
const AGENT = "priya@servio.dev";
const END_USER = "emma@servio.dev";

const db = new PrismaClient();

/** Run `fn` with the user's language set to German. Tests run in parallel, so this is per user. */
async function asGerman(email: string, fn: () => Promise<void>) {
  await db.user.update({ where: { email }, data: { locale: "de" } });
  try {
    await fn();
  } finally {
    await db.user.update({ where: { email }, data: { locale: "auto" } });
  }
}

test.afterAll(async () => {
  await db.$disconnect();
});

async function logIn(page: Page, email: string) {
  // No language cookie and the instance default (English): the sign-in page is English.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function failureTable(failures: Failure[]): string {
  return failures.map((f) => `${f.source.padEnd(32)} ${f.target.padEnd(40)} ${f.reason}`).join("\n");
}

test("the sign-in page switches to German and remembers it", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.reload();
  await expect(page.getByLabel("Passwort")).toBeVisible();
});

test("a German agent gets the console in German, and every linked page loads", async ({ page }) =>
  asGerman(AGENT, async () => {
    await logIn(page, AGENT);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const sidebar = page.locator("[data-sidebar=sidebar]");
    await expect(sidebar.getByText("Übersicht")).toBeVisible();
    await expect(sidebar.getByText("Wissensdatenbank")).toBeVisible();

    await page.goto("/tickets");
    await expect(page.getByText("Neues Ticket").first()).toBeVisible();

    const { visited, failures } = await crawl({ page, start: "/", maxPages: 150, maxPerShape: 2 });
    console.log(`de agent: visited ${visited} pages, ${failures.length} broken`);
    expect(failures.length, `\n${failureTable(failures)}\n`).toBe(0);
  }));

test("a German end user gets the portal in German, and every linked page loads", async ({ page }) =>
  asGerman(END_USER, async () => {
    await logIn(page, END_USER);
    await page.goto("/portal");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");

    const { visited, failures } = await crawl({ page, start: "/portal", maxPages: 80, maxPerShape: 2 });
    console.log(`de end user: visited ${visited} pages, ${failures.length} broken`);
    expect(failures.length, `\n${failureTable(failures)}\n`).toBe(0);
  }));
