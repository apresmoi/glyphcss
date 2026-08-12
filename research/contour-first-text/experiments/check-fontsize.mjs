import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto("http://localhost:4323/wordart", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll(".wa-tile")];
  const out = [];
  for (const t of tiles) {
    const label = t.querySelector(".wa-tile__label")?.textContent;
    if (!/Matrix Fall|Grass Block/.test(label)) continue;
    const pre = t.querySelector("pre");
    const thumb = t.querySelector(".wa-tile__thumb");
    out.push({
      label,
      preClass: pre?.className,
      preFontSize: pre ? getComputedStyle(pre).fontSize : null,
      preLineHeight: pre ? getComputedStyle(pre).lineHeight : null,
      thumbClass: thumb?.className,
      hostClass: pre?.parentElement?.className,
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
