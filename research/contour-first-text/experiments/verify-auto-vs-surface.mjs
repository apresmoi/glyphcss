// Deterministic (no timing/noise) verification that composeText's authored
// UVs actually change which code path `space: "auto"` resolves to.
//
// Before the fix: solid-color text polygons carried no `uvs`, so
// `context.base.uv0` was never populated (needSurfaceUv only turns on when
// some polygon has `uvs`) — `space: "auto"` always fell through to the
// generated-surface fallback, i.e. IDENTICAL output to explicitly forcing
// `space: "surface"`.
//
// After the fix: every text polygon authors UVs, so `uv0` is populated and
// `space: "auto"` resolves the authored-UV path — which should now produce
// DIFFERENT output than `space: "surface"` (which still forces the
// generated-surface fallback regardless of uv0 availability).
//
// This sidesteps optical-flow/PCA measurement noise entirely: we just diff
// two renders' text/color content at a single, fixed mesh rotation and
// effect-clock instant (freeze `time` isn't controllable from the URL, so we
// grab both frames back-to-back on the SAME page load — two effect layers,
// same params, evaluated within the same render/animation frame).
import { chromium } from "playwright";

function withFx(spaceValue, turnDeg = 40) {
  const fxx = {
    glyphs: "GLYPH01",
    direction: "right",
    scale: 2.56,
    speedMin: 40,
    speedMax: 40,
    trail: 59,
    density: 1,
    seed: 6428,
    colorMode: "monochrome",
    color: "#1aa34a",
    headColor: "#baffd6",
    ...(spaceValue ? { space: spaceValue } : {}),
  };
  const q = new URLSearchParams({
    text: "HELLO",
    profile: "flat",
    depth: "10",
    color: "#1d6b3a",
    side: "#0f3a20",
    back: "#0f3a20",
    tilt: "0",
    density: "2.6",
    hl: "hide",
    spin: "0",
    turn: String(turnDeg),
    fx: "matrix-rain",
    fxs: "1.8",
    fxp: "1",
    fxx: JSON.stringify(fxx),
  });
  return `http://localhost:4323/wordart?${q.toString()}`;
}

async function grab(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("pre");
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const pre = document.querySelector("pre");
    const spans = pre.querySelectorAll("span");
    let coloredChars = 0;
    const colorSet = new Set();
    for (const el of spans) {
      const c = getComputedStyle(el).color;
      if (c === "rgb(0, 0, 0)") continue;
      coloredChars += el.textContent?.length ?? 0;
      colorSet.add(c);
    }
    return { text: pre.textContent, coloredChars, uniqueColors: colorSet.size };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  for (const turn of [0, 40, 75]) {
    const auto = await grab(page, withFx(undefined, turn));
    const surface = await grab(page, withFx("surface", turn));
    const scene = await grab(page, withFx("scene", turn));
    console.log(`\n=== turn=${turn} ===`);
    console.log(`auto:    ${auto.coloredChars} colored, ${auto.uniqueColors} unique colors`);
    console.log(`surface: ${surface.coloredChars} colored, ${surface.uniqueColors} unique colors`);
    console.log(`scene:   ${scene.coloredChars} colored, ${scene.uniqueColors} unique colors`);
    console.log(`auto === surface (forced generated-surface fallback)? ${auto.text === surface.text}`);
    console.log(`auto === scene   (forced scene-projected mapping)?     ${auto.text === scene.text}`);
  }

  await browser.close();
})();
