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

test("website-generative is the shared full-screen synth apparatus with one B5/B32 source", async ({ page }, testInfo) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  const requestedModelWeights: string[] = [];
  page.on("request", (request) => {
    if (/\.(onnx|safetensors|gguf|bin)(?:\?|$)/i.test(request.url())) requestedModelWeights.push(request.url());
  });

  const response = await page.goto(`${baseUrl}/generative/`);
  expect(response?.status()).toBe(200);
  const shell = page.locator(".synth-shell.dn-root.dn-root--generative");
  await expect(shell).toBeVisible();
  await expect(shell.locator(".synth-body")).toHaveCount(1);
  await expect(shell.locator(".synth-voices")).toBeVisible();
  await expect(shell.locator(".synth-main .synth-viewport")).toBeVisible();
  await expect(shell.locator("#generative-controls-panel.dn-floating-controls")).toBeVisible();
  await expect(shell.locator("#generative-maps-panel.synth-presets")).toBeVisible();
  await expect(shell.locator(".dn-mobile-tabs")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Generative controls", exact: true })).toHaveCount(1);

  const stage = page.getByRole("region", { name: "Control frame stage" });
  await expect(stage).toHaveAttribute("data-control-frame-count", "1");
  const frameHash = await stage.getAttribute("data-stage-frame-sha256");
  const tensorHash = await stage.getAttribute("data-stage-tensor-spec-sha256");
  expect(frameHash).toMatch(/^[a-f0-9]{64}$/);
  expect(tensorHash).toMatch(/^[a-f0-9]{64}$/);

  const panels = page.getByRole("list", { name: "Conditioning maps" }).locator("[data-control-panel]");
  await expect(panels).toHaveCount(8);
  await expect(panels.locator(".synth-tile-label")).toContainText([
    "VIS Visible ASCII",
    "SEM Semantic ASCII",
    "Z Depth",
    "NRM Normals",
    "XYZ World position",
    "UV UV",
    "COV Coverage",
    "LIT Shade",
  ]);
  expect(new Set(await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-frame-sha256"))))).toEqual(new Set([frameHash]));
  expect(new Set(await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tensor-spec-sha256"))))).toEqual(new Set([tensorHash]));
  const numeric = page.locator('[data-control-panel][data-first-plane]');
  await expect(numeric).toHaveCount(6);
  expect(await numeric.evaluateAll((nodes) => nodes.map((node) => [
    Number(node.getAttribute("data-first-plane")),
    Number(node.getAttribute("data-plane-width")),
  ]))).toEqual([[5, 1], [6, 3], [9, 3], [12, 2], [14, 1], [15, 1]]);

  const output = page.locator(".gen-output");
  await expect(output).toHaveAttribute("data-generated-panel", "idle");
  await expect(output).toContainText("LOCAL RETRIEVAL IDLE");
  await expect(output).toContainText("No paid or hidden remote call is used");
  expect(await page.evaluate(async () => {
    await document.fonts.load('10px "Glyph Control"');
    return document.fonts.check('10px "Glyph Control"');
  })).toBe(true);
  expect(requestedModelWeights).toEqual([]);
  await testInfo.attach("generative-desktop", { body: await page.screenshot(), contentType: "image/png" });
  assertNoBrowserFailures();
});

test("website-generative prompt, planned style, maps, lineage, and future builder stay honest", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  await page.goto(`${baseUrl}/generative/`);

  const dock = page.locator("#generative-controls-panel");
  await expect(dock).toContainText("APPEARANCE");
  await expect(dock).toContainText("MODEL");
  await expect(dock).toContainText("CONTROL FRAME");
  await expect(dock).toContainText("CELL LINEAGE");
  await expect(dock.locator(".controller.string").filter({ hasText: "State" }).locator("input")).toHaveValue("idle");
  await expect(dock.locator(".controller.string").filter({ hasText: "Training" }).locator("input")).toHaveValue("786,432 native continuation pixels");
  const prompt = dock.locator(".controller.string input").first();
  await prompt.fill("blue ceramic in a quiet studio");
  await dock.locator(".controller.option select").first().selectOption({ label: "Style B · unloaded" });
  const output = page.locator(".gen-output");
  await expect(output).toContainText("blue ceramic in a quiet studio");
  await expect(output).toContainText("style B");

  await expect(page.getByRole("button", { name: "Builder · future", exact: true })).toBeDisabled();
  await expect(page.getByText("no untrained IDs are invented", { exact: false })).toBeVisible();
  await page.locator('[data-control-panel="Semantic ASCII"]').click();
  const semanticGrid = page.getByRole("grid", { name: "Semantic ASCII control map" });
  await expect(semanticGrid).toBeVisible();
  await expect(semanticGrid.locator('[tabindex="0"]')).toHaveCount(1);
  const selected = semanticGrid.locator('button[aria-pressed="true"]');
  await selected.focus();
  const initial = await selected.getAttribute("data-cell-index");
  await page.keyboard.press("ArrowDown");
  const moved = semanticGrid.locator('button[aria-pressed="true"]');
  await expect(moved).toBeFocused();
  expect(await moved.getAttribute("data-cell-index")).not.toBe(initial);
  await expect(page.getByRole("complementary", { name: "Selected cell lineage" })).toContainText("generative/cube");
  await expect(moved).toHaveCSS("color", "rgb(230, 57, 70)");
  assertNoBrowserFailures();
});

test("website-generative rebuilds one synchronized frame and tensor for cube, sphere, and prism", async ({ page }) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  await page.goto(`${baseUrl}/generative/`);
  const stage = page.getByRole("region", { name: "Control frame stage" });
  const panels = page.getByRole("list", { name: "Conditioning maps" }).locator("[data-control-panel]");
  const seenFrames = new Set<string>();
  const seenTensors = new Set<string>();

  for (const primitive of ["Cube", "Sphere", "Prism"]) {
    await page.getByRole("button", { name: new RegExp(`^${primitive}`) }).click();
    const frameHash = await stage.getAttribute("data-stage-frame-sha256");
    const tensorHash = await stage.getAttribute("data-stage-tensor-spec-sha256");
    expect(frameHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tensorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-frame-sha256"))))).toEqual(new Set([frameHash]));
    expect(new Set(await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tensor-spec-sha256"))))).toEqual(new Set([tensorHash]));
    seenFrames.add(frameHash!);
    seenTensors.add(tensorHash!);
    await page.locator('[data-control-panel="Visible ASCII"]').click();
    const grid = page.getByRole("grid", { name: "Visible ASCII control map" });
    await expect(grid).toBeVisible();
    await grid.locator("button").first().click();
    const lineage = page.getByRole("complementary", { name: "Selected cell lineage" });
    await expect(lineage).toContainText(`generative/${primitive.toLowerCase()}`);
    await expect(stage.locator(".gen-stage-footer")).toContainText(`GEOMETRY ${primitive.toLowerCase()}`);
  }
  expect(seenFrames.size).toBe(3);
  expect(seenTensors.size).toBe(3);
  assertNoBrowserFailures();
});

test("website-generative keeps the stage primary and apparatus drawers operable on mobile", async ({ page }, testInfo) => {
  const assertNoBrowserFailures = watchBrowserFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/generative/`);
  await expect(page.locator(".gen-stage")).toBeVisible();
  await expect(page.locator("#generative-sources-panel")).toBeHidden();
  await expect(page.locator("#generative-controls-panel")).toBeHidden();
  await expect(page.locator("#generative-maps-panel")).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Generative panels" });
  await expect(tabs.getByRole("button")).toHaveCount(4);

  await tabs.getByRole("button", { name: "Sources" }).click();
  await expect(page.locator("#generative-sources-panel")).toBeVisible();
  await tabs.getByRole("button", { name: "Maps" }).click();
  await expect(page.locator("#generative-sources-panel")).toBeHidden();
  await expect(page.locator("#generative-maps-panel")).toBeVisible();
  await tabs.getByRole("button", { name: "Controls" }).click();
  await expect(page.locator("#generative-maps-panel")).toBeHidden();
  await expect(page.locator("#generative-controls-panel")).toBeVisible();
  await tabs.getByRole("button", { name: "Output" }).click();
  await expect(page.locator("#generative-controls-panel")).toBeHidden();
  await expect(page.locator(".gen-output")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  await testInfo.attach("generative-mobile", { body: await page.screenshot(), contentType: "image/png" });
  assertNoBrowserFailures();
});
