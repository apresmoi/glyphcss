import { expect, test, type Page } from "playwright/test";

const baseUrl = (process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "");

function watchBrowserFailures(page: Page): () => void {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror at ${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console at ${page.url()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    // The deployed site includes telemetry in BaseHead. Local Chromium aborts
    // that off-origin beacon during teardown; it cannot affect Gallery's
    // hydration or renderer. Every first-party and other third-party failure
    // remains a test failure.
    if (new URL(request.url()).hostname.endsWith("google-analytics.com")) return;
    failures.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  return () => {
    if (failures.length) throw new Error(failures.join("\n"));
  };
}

async function openGallery(page: Page, scene = ""): Promise<void> {
  const response = await page.goto(`${baseUrl}/gallery/?model=primitive-cube${scene ? `&scene=${scene}` : ""}`);
  expect(response?.status()).toBe(200);
  // These are rendered only by the client: seeing all of them proves this is
  // the hydrated Gallery workbench rather than Astro's static site chrome.
  await page.locator(".dn-root--gallery .dn-main .dn-viewport").waitFor({ state: "visible" });
  await page.locator(".dn-root--gallery .dn-vanilla-host").waitFor({ state: "visible" });
  await page.locator("#gallery-controls-panel").waitFor({ state: "attached" });
  await page.locator("pre.glyph-output").waitFor({ state: "visible" });
  await page.waitForFunction(() => (document.querySelector("pre.glyph-output")?.textContent ?? "").trim().length > 0);
}

function renderModeSelect(page: Page) {
  return page.locator("#gallery-controls-panel select").first();
}

async function settledOutput(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const output = document.querySelector("pre.glyph-output")?.textContent ?? "";
    const key = "__glyphcssGalleryLastOutput";
    const previous = (window as unknown as Window & Record<string, unknown>)[key];
    (window as unknown as Window & Record<string, unknown>)[key] = output;
    return output.length > 0 && previous === output;
  });
  return await page.locator("pre.glyph-output").textContent() ?? "";
}

// Wireframe deliberately chooses visual glyph variants randomly. Its covered
// cells are deterministic, so compare occupancy/topology rather than bytes.
function occupancySignature(output: string): string {
  return output.replace(/[^\s]/g, "#");
}

async function selectSemanticCell(page: Page, expectColors: boolean, closeControlsBeforeCellClick = false): Promise<void> {
  const mode = renderModeSelect(page);
  await expect(mode).toHaveValue("Wireframe");
  // Native lil-gui selects retain ordinary keyboard behaviour: End chooses
  // the final Semantic option, then Enter commits it.
  await mode.focus();
  await expect(mode).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(mode).toHaveValue("Semantic");

  const legend = page.getByLabel("Semantic dictionary legend");
  await expect(legend.getByText("cube", { exact: true })).toBeVisible();
  const glyph = await legend.locator("code").first().textContent();
  if (!glyph || glyph.length !== 1) throw new Error("semantic dictionary legend has no single-cell glyph");

  const output = page.locator("pre.glyph-output");
  await page.waitForFunction(({ selector, glyph: expectedGlyph }) =>
    (document.querySelector(selector)?.textContent ?? "").includes(expectedGlyph),
  { selector: "pre.glyph-output", glyph });
  if (expectColors) await expect(output.locator("span").first()).toBeVisible();
  else await expect(output.locator("span")).toHaveCount(0);

  if (closeControlsBeforeCellClick) {
    await page.getByRole("button", { name: "Controls", exact: true }).click();
  }

  const text = await output.textContent();
  const lines = (text ?? "").split("\n");
  const row = lines.findIndex((line) => line.includes(glyph));
  const col = row < 0 ? -1 : lines[row]!.indexOf(glyph);
  if (row < 0 || col < 0 || !lines[row]!.length || !lines.length) {
    throw new Error("semantic output contains no deterministic non-empty cell");
  }
  const bounds = await output.boundingBox();
  if (!bounds) throw new Error("semantic output has no measurable grid");
  await output.click({
    position: {
      x: ((col + 0.5) / lines[row]!.length) * bounds.width,
      y: ((row + 0.5) / lines.length) * bounds.height,
    },
  });
  const lineage = page.getByText(/polygon \d+ → gallery\/cube\/face-\d+ → gallery\/cube → cube/);
  if (closeControlsBeforeCellClick) await expect(lineage).toContainText(/polygon \d+ → gallery\/cube\/face-\d+ → gallery\/cube → cube/);
  else await expect(lineage).toBeVisible();
}

test("gallery-semantic", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  await openGallery(page);
  await renderModeSelect(page).selectOption({ label: "Wireframe" });
  const cubeWireframeBaseline = occupancySignature(await settledOutput(page));
  await selectSemanticCell(page, true);

  const semanticBytes = await page.locator("pre.glyph-output").textContent();
  expect(semanticBytes).toContain("A");
  expect(occupancySignature(semanticBytes ?? "")).not.toBe(cubeWireframeBaseline);
  await expect(page.locator(".dn-viewport .gallery-semantic-details")).toHaveCount(0);
  await expect(page.locator("#gallery-controls-panel .gallery-semantic-details")).toBeVisible();

  const mode = renderModeSelect(page);
  await mode.selectOption({ label: "Wireframe" });
  await expect(mode).toHaveValue("Wireframe");
  await expect(page.getByLabel("Semantic dictionary legend")).toHaveCount(0);
  await expect.poll(async () => occupancySignature(await settledOutput(page))).toBe(cubeWireframeBaseline);
  await mode.selectOption({ label: "Semantic" });
  await expect(mode).toHaveValue("Semantic");
  await expect(page.locator("pre.glyph-output")).toHaveText(semanticBytes ?? "");
  // Establish an actual Tetrahedron wireframe baseline before exercising the
  // semantic→unsupported asynchronous preset transition.
  await page.getByRole("button", { name: "Tetrahedron", exact: true }).click();
  await expect(renderModeSelect(page)).toHaveValue("Wireframe");
  const tetraWireframeBaseline = occupancySignature(await settledOutput(page));
  await page.getByRole("button", { name: "Cube", exact: true }).click();
  await expect(renderModeSelect(page)).toHaveValue("Wireframe");
  await renderModeSelect(page).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(renderModeSelect(page)).toHaveValue("Semantic");
  await page.getByRole("button", { name: "Tetrahedron", exact: true }).click();
  await expect(renderModeSelect(page)).toHaveValue("Wireframe");
  await expect(renderModeSelect(page).getByRole("option", { name: "Semantic" })).toBeDisabled();
  await expect(page.getByLabel("Semantic dictionary legend")).toHaveCount(0);
  await expect.poll(async () => occupancySignature(await settledOutput(page))).toBe(tetraWireframeBaseline);
  await expect(page.getByText("Semantic labels are available for the authored Cube fixture.")).toBeVisible();
  assertNoBrowserFailures();
});

test("gallery-semantic plain output", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  // `U0` is Gallery's public compact route state for `useColors: false`.
  await openGallery(page, "2U0");
  await renderModeSelect(page).selectOption({ label: "Wireframe" });
  await selectSemanticCell(page, false);
  assertNoBrowserFailures();
});

test("gallery-semantic is usable on a mobile viewport", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGallery(page);
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  const controls = page.locator("#gallery-controls-panel");
  const bounds = await controls.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? -1) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await renderModeSelect(page).selectOption({ label: "Wireframe" });
  await selectSemanticCell(page, true, true);
  assertNoBrowserFailures();
});
