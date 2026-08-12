// Scratch verification script (not part of the shipped codebase) — configures
// non-default state on /wordart, /gallery, /synth, reads the resulting URL,
// reloads it in a fresh page, and compares the restored <pre> render + a few
// control values. Run: node urlstate-playwright-check.js
const { chromium } = require("playwright");

const BASE = "http://localhost:4324";

async function withPage(browser, fn) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    return await fn(page, errors);
  } finally {
    await page.close();
  }
}

async function getPreText(page) {
  return page.evaluate(() => {
    const pre = document.querySelector("pre.glyph-output");
    return pre ? pre.textContent : null;
  });
}

async function checkWordArt(browser) {
  console.log("\n=== /wordart ===");
  return withPage(browser, async (page, errors) => {
    await page.goto(`${BASE}/wordart`, { waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(600);

    const textarea = await page.$("textarea");
    await textarea.click({ clickCount: 3 });
    await textarea.fill("URLSTATE\nCHECK");
    await page.waitForTimeout(400);

    const before = new URL(page.url());
    const beforeW = before.searchParams.get("w");
    console.log("URL param (w):", before.search, "length:", beforeW ? beforeW.length : 0);
    const beforeTextareaValue = await textarea.inputValue();

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(600);
    const afterTextarea = await page.$("textarea");
    const afterTextareaValue = await afterTextarea.inputValue();
    const afterParam = new URL(page.url()).searchParams.get("w");
    const preHasText = (await getPreText(page)) || "";

    console.log("param preserved across reload:", afterParam === beforeW);
    console.log("textarea value restored:", afterTextareaValue === beforeTextareaValue, JSON.stringify(afterTextareaValue));
    console.log("<pre> is non-empty after reload:", preHasText.trim().length > 0);
    console.log("page errors:", errors);
    return {
      beforeW,
      afterParam,
      paramMatch: afterParam === beforeW,
      textareaMatch: afterTextareaValue === beforeTextareaValue,
      errors,
    };
  });
}

async function checkGallery(browser) {
  console.log("\n=== /gallery ===");
  return withPage(browser, async (page, errors) => {
    await page.goto(`${BASE}/gallery`, { waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(800);

    // Drag-orbit the viewport to change rotX/rotY (marks the scene route dirty).
    const canvas = await page.$(".viewport, main, body");
    const box = canvas ? await canvas.boundingBox() : null;
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 60, { steps: 10 });
      await page.mouse.up();
    }
    await page.waitForTimeout(500);

    const before = new URL(page.url());
    console.log("URL:", before.search);
    const beforePre = await getPreText(page);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(800);
    const afterPre = await getPreText(page);
    const afterUrl = new URL(page.url());

    console.log("scene param preserved:", afterUrl.searchParams.get("scene") === before.searchParams.get("scene"));
    console.log("<pre> matches after reload:", afterPre === beforePre);
    console.log("page errors:", errors);
    return { before: before.search, after: afterUrl.search, match: afterPre === beforePre, errors };
  });
}

// Sets a React-controlled <input type="range"> value using the native
// setter (React overrides the plain `.value=` setter, so a raw DOM write is
// silently ignored — this is the standard workaround) then dispatches the
// events React listens for.
async function setRangeInput(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const input = document.querySelector(selector);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, value });
}

async function checkSynth(browser) {
  console.log("\n=== /synth ===");
  return withPage(browser, async (page, errors) => {
    await page.goto(`${BASE}/synth`, { waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(800);

    // Voice 1's freq slider is a real, reliably-present persisted control.
    await setRangeInput(page, ".voice-slider-track input[type=range]", 17.3);
    await page.waitForTimeout(400);

    const before = new URL(page.url());
    const beforeS = before.searchParams.get("s");
    console.log("URL param (s):", before.search, "length:", beforeS ? beforeS.length : 0);
    const beforeFreq = await page.$eval(".voice-slider-track input[type=range]", (el) => el.value);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("pre.glyph-output", { timeout: 15000 });
    await page.waitForTimeout(800);
    const afterFreq = await page.$eval(".voice-slider-track input[type=range]", (el) => el.value);
    const afterS = new URL(page.url()).searchParams.get("s");
    const preHasText = (await getPreText(page)) || "";

    console.log("param preserved across reload:", afterS === beforeS);
    console.log("freq slider value restored:", afterFreq === beforeFreq, `(${beforeFreq} -> ${afterFreq})`);
    console.log("<pre> is non-empty after reload:", preHasText.trim().length > 0);
    console.log("page errors:", errors);
    return { beforeS, afterS, paramMatch: afterS === beforeS, freqMatch: afterFreq === beforeFreq, errors };
  });
}

(async () => {
  const browser = await chromium.launch();
  try {
    const w = await checkWordArt(browser);
    const g = await checkGallery(browser);
    const s = await checkSynth(browser);
    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify({ wordart: w, gallery: g, synth: s }, null, 2));
  } finally {
    await browser.close();
  }
})();
