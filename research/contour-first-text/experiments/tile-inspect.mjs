import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto("http://localhost:4323/wordart", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const tiles = await page.locator(".wa-tile").all();
for (const t of tiles) {
  const label = (await t.textContent()).trim().split("\n").pop();
  if (label === "Matrix Fall") {
    const pre = t.locator("pre").first();
    console.log("RAW:\n" + await pre.textContent());
    await t.screenshot({ path: "/tmp/matrixfall_tile.png" });
  }
}
await browser.close();
