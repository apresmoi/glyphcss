import { expect, test, type Page } from "playwright/test";

const baseUrl = (process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "");

function watchBrowserFailures(page: Page): () => void {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror at ${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console at ${page.url()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).hostname.endsWith("google-analytics.com")) return;
    if (request.failure()?.errorText === "net::ERR_ABORTED" && request.url().includes("/node_modules/.vite/deps/")) return;
    failures.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  return () => {
    if (failures.length) throw new Error(failures.join("\n"));
  };
}

test("gallery-regression keeps the general gallery independent and functional", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  const response = await page.goto(`${baseUrl}/gallery/?model=primitive-cube`);
  expect(response?.status()).toBe(200);
  await page.locator(".dn-root--gallery .dn-main .dn-viewport").waitFor({ state: "visible" });
  await page.locator("#gallery-controls-panel").waitFor({ state: "attached" });
  const output = page.locator("pre.glyph-output");
  await output.waitFor({ state: "visible" });
  await expect.poll(async () => (await output.textContent() ?? "").trim().length).toBeGreaterThan(0);

  await expect(page.locator("#gallery-models-panel .sidebar-item").filter({ hasText: /^Cube$/ })).toHaveCount(1);
  await expect(page.locator("#gallery-models-panel .sidebar-item").filter({ hasText: /^Tetrahedron$/ })).toHaveCount(1);
  await expect(page.locator("#gallery-models-panel .sidebar-item.active")).toHaveText("Cube");
  const renderMode = page.locator("#gallery-controls-panel select").first();
  await expect(renderMode).toHaveValue("Solid");
  await renderMode.selectOption({ label: "Wireframe" });
  await expect(renderMode).toHaveValue("Wireframe");
  await expect.poll(async () => (await output.textContent() ?? "").trim().length).toBeGreaterThan(0);
  await renderMode.selectOption({ label: "Solid" });
  await expect(renderMode).toHaveValue("Solid");
  await expect.poll(async () => (await output.textContent() ?? "").trim().length).toBeGreaterThan(0);

  await expect(page.locator("[data-control-panel]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Generative controls", exact: true })).toHaveCount(0);
  await expect(page.locator('nav a[href="/generative"]')).toHaveCount(1);
  await expect(page.locator('nav a[href="/gallery"]')).toHaveClass(/active/);
  assertNoBrowserFailures();
});

test("gallery-regression keeps the synth workbench independent and functional", async ({ page }, testInfo) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  const response = await page.goto(`${baseUrl}/synth/`);
  expect(response?.status()).toBe(200);
  await page.locator(".synth-shell.dn-root--synth").waitFor({ state: "visible" });
  const output = page.locator(".synth-viewport pre.glyph-output");
  await output.waitFor({ state: "visible" });
  await expect.poll(async () => (await output.textContent() ?? "").trim().length).toBeGreaterThan(0);

  const voices = page.locator(".voice-card");
  const initialVoiceCount = await voices.count();
  expect(initialVoiceCount).toBeGreaterThan(0);
  const addVoice = page.getByRole("button", { name: "+ Add", exact: true });
  if (initialVoiceCount < 6) {
    await addVoice.click();
    await expect(voices).toHaveCount(initialVoiceCount + 1);
  }
  await expect(page.getByRole("list", { name: "Pattern presets" }).locator(".synth-tile").first()).toBeVisible();
  await expect(page.locator("[data-control-panel]")).toHaveCount(0);
  await expect(page.locator('nav a[href="/synth"]')).toHaveClass(/active/);
  await testInfo.attach("synth-desktop", { body: await page.screenshot(), contentType: "image/png" });
  assertNoBrowserFailures();
});
