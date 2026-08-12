import { chromium } from "playwright";
const url = process.argv[2];
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const text = await page.evaluate(() => {
  const pre = document.querySelector("pre.glyph-output") || document.querySelector("pre");
  return pre ? pre.textContent : "NO PRE FOUND";
});
await browser.close();
console.log(text);
