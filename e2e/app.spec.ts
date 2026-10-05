import { expect, test, type Page } from "@playwright/test";

const LLM = "http://localhost:4111/v1";
const LLM_NO_CORS = "http://localhost:4112/v1";
const REPO = "github.com/demo/notes-app";

async function configure(page: Page, { baseUrl = LLM, key = "good-key", model = "mock/narrator" } = {}) {
  await page.goto("/");
  // With no saved key the settings panel opens by itself.
  await page.getByLabel("Base URL").fill(baseUrl);
  await page.getByLabel("API key").fill(key);
  await page.getByLabel("Model", { exact: true }).fill(model);
  await page.getByLabel("Repository").fill(REPO);
}

test("turns a repository into a listening script", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await configure(page);
  await page.getByRole("button", { name: "Generate walkthrough" }).click();

  await expect(page.getByRole("heading", { name: "A guided tour of notes-app" })).toBeVisible({ timeout: 60_000 });
  // Lockfiles and images never reach the tour; the app's own files do.
  await expect(page.getByText("src/App.jsx")).toBeVisible();
  await expect(page.getByText("package-lock.json")).toHaveCount(0);

  await page.getByRole("button", { name: "Copy script" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const script = await page.evaluate(() => navigator.clipboard.readText());
  expect(script.startsWith("A guided tour of notes app.")).toBe(true);
  expect(script).toContain("Chapter one. Where it all starts.");
  expect(script).toContain("Last stop. Where to go when you want to change something.");
  expect(script).not.toMatch(/[#*`]/);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download as Markdown" }).click()]);
  expect(download.suggestedFilename()).toBe("demo-notes-app-talkthrough.md");

  // The finished walkthrough survives a reload.
  await page.reload();
  await page.getByRole("button", { name: /open your last walkthrough/i }).click();
  await expect(page.getByRole("heading", { name: "A guided tour of notes-app" })).toBeVisible();
});

test("explains a rejected key in plain language", async ({ page }) => {
  await configure(page, { key: "wrong-key" });
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Your API key didn't work" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText("rejected the API key");
});

test("falls back to the relay when a provider blocks browser requests", async ({ page }) => {
  await configure(page, { baseUrl: LLM_NO_CORS });
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  await expect(page.getByRole("heading", { name: "A guided tour of notes-app" })).toBeVisible({ timeout: 60_000 });
});

test("rides out rate limits", async ({ page }) => {
  await configure(page, { model: "flaky" });
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  await expect(page.getByRole("heading", { name: "A guided tour of notes-app" })).toBeVisible({ timeout: 80_000 });
});

test("says when a repository can't be found", async ({ page }) => {
  await configure(page);
  await page.getByLabel("Repository").fill("github.com/demo/does-not-exist");
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Repository not found" })).toBeVisible({ timeout: 30_000 });
});

test("rejects links that aren't GitHub repositories", async ({ page }) => {
  await configure(page);
  await page.getByLabel("Repository").fill("https://gitlab.com/a/b");
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "only reads GitHub repositories" })).toBeVisible({ timeout: 30_000 });
});

test("stops a run and resumes without redoing finished parts", async ({ page }) => {
  let ingests = 0;
  let chats = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/ingest")) ingests++;
    if (r.method() === "POST" && r.url().endsWith("/chat/completions")) chats++;
  });
  await configure(page, { model: "slow" });
  await page.getByRole("button", { name: "Generate walkthrough" }).click();
  await expect(page.getByText(/^[1-9]\d* of \d+ parts$/)).toBeVisible({ timeout: 30_000 });

  // A real click: the Stop button must not turn into the submit button mid-click.
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Stopped. Finished parts are kept if you resume.")).toBeVisible();
  expect(ingests).toBe(1);
  const [finished, total] = (await page.getByText(/^\d+ of \d+ parts$/).innerText()).match(/\d+/g)!.map(Number);
  expect(finished).toBeGreaterThan(0);

  const before = chats;
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { name: "A guided tour of notes-app" })).toBeVisible({ timeout: 90_000 });
  // Only the unfinished parts (a draft and a second look each), the introduction and the closing.
  expect(chats - before).toBeLessThanOrEqual(2 * (total - finished) + 2);
});
