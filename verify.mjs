import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:4323/gallery?model=1077386620", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const cubeSnippet = await page.textContent(".gw-code-panel__code");
console.log("=== CUBE (primitive-cube) snippet ===");
console.log(cubeSnippet);
console.log("\n----\n");

// Switch to cylinder primitive (id primitive-cylinder) — find via picker
await page.evaluate(() => {
  const w = window;
  w.__demoSet = (id) => {
    const ev = new CustomEvent("gallery:reset-preset", { detail: { id, updateRoute: false } });
    document.dispatchEvent(ev);
  };
});
