import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto("http://localhost:4323/wordart", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

function inkedBBox(text) {
  const lines = text.split("\n");
  let minRow=Infinity,maxRow=-Infinity,minCol=Infinity,maxCol=-Infinity;
  lines.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== " " && line[c] !== " ") {
        if (r<minRow) minRow=r; if (r>maxRow) maxRow=r;
        if (c<minCol) minCol=c; if (c>maxCol) maxCol=c;
      }
    }
  });
  return { rows: lines.length, cols: Math.max(...lines.map(l=>l.length)), minRow, maxRow, minCol, maxCol };
}

const tiles = await page.locator(".wa-tile").all();
const labels = await page.locator(".wa-tile__label, .wa-tile").allTextContents();
for (let i = 0; i < tiles.length; i++) {
  const label = (await tiles[i].textContent()).trim().split("\n").pop();
  if (!/Matrix Fall|Scan Pulse|Grass Block/.test(label)) continue;
  const pre = tiles[i].locator("pre").first();
  const text = await pre.textContent().catch(() => null);
  if (!text) { console.log(label, "NO PRE"); continue; }
  console.log(label, JSON.stringify(inkedBBox(text)));
}
await browser.close();
