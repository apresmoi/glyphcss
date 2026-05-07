import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

// Parse positional args: ignore --flags. argv[2] = url, argv[3] = output path.
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const URL = (positional[0] && positional[0].length > 0)
  ? positional[0]
  : "http://localhost:4400/perf-cracks.html?mesh=sting&paint=red&normalize=true&autoCenter=true&rotX=83.79&rotY=182.21&zoom=1.6377";
const OUT = positional[1] ?? "/tmp/snap.png";
const SHOW_BACKFACES = process.argv.includes("--backfaces");
const WIDTH = 1280, HEIGHT = 800;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(URL);
// .polycss-scene is a 0×0 anchor (position:absolute top/left:50%) so
// Playwright's default visibility check fails. Wait for it to be in the
// DOM instead, then for at least one rendered <i> child to exist.
await page.waitForSelector(".polycss-scene", { state: "attached", timeout: 10000 });
await page.waitForFunction(() => {
  const scene = document.querySelector(".polycss-scene");
  return scene && scene.querySelectorAll("i").length > 0;
}, { timeout: 15000 });
// Give the atlas blob URLs a moment to load + the browser to composite.
await page.waitForTimeout(1500);

// Hide the HUD/legend overlays so they don't cover the mesh in the shot.
let css = "#hud, #legend, #cam { display: none !important; }";
if (SHOW_BACKFACES) {
  // Force backface visibility on every polygon — used to test whether
  // visible "cracks" in red mode are actually back-culled polygons.
  css += " .polycss-scene i { backface-visibility: visible !important; -webkit-backface-visibility: visible !important; }";
}
await page.addStyleTag({ content: css });
await page.waitForTimeout(150);

await page.screenshot({ path: OUT, fullPage: false });

// Compute coverage stats: count R/G/B values across pixels.
const stats = await page.evaluate(async () => {
  const sceneEl = document.querySelector(".polycss-scene");
  if (!sceneEl) return null;
  const W = window.innerWidth, H = window.innerHeight;
  // We can't easily readback DOM, so just return scene bbox + viewport size.
  const r = sceneEl.getBoundingClientRect();
  return { sceneBox: { x: r.x, y: r.y, w: r.width, h: r.height }, viewport: { w: W, h: H } };
});
console.log(JSON.stringify(stats));

await browser.close();
