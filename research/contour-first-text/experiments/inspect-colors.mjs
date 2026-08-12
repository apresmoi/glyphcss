import { chromium } from "playwright";

const BASE =
  "http://localhost:4323/wordart?text=Glyph%0ACSS&profile=flat&depth=10&color=%231d6b3a&side=%230f3a20&back=%230f3a20&curve=4&tilt=0.9&density=2.6&hl=hide&fx=matrix-rain&fxs=1.8&fxx=%7B%22glyphs%22%3A%22GLYPH01%22%2C%22direction%22%3A%22right%22%2C%22scale%22%3A2.56%2C%22speedMin%22%3A40%2C%22speedMax%22%3A40%2C%22trail%22%3A59%2C%22density%22%3A1%2C%22seed%22%3A6428%2C%22colorMode%22%3A%22monochrome%22%2C%22color%22%3A%22%231aa34a%22%2C%22headColor%22%3A%22%23baffd6%22%7D";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}&spin=0&turn=0`, { waitUntil: "networkidle" });
  await page.waitForSelector("pre");
  await page.waitForTimeout(500);
  const counts = await page.evaluate(() => {
    const pre = document.querySelector("pre");
    const spans = pre.querySelectorAll("span");
    const m = new Map();
    for (const el of spans) {
      const c = getComputedStyle(el).color;
      m.set(c, (m.get(c) ?? 0) + (el.textContent?.length ?? 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  });
  console.log(JSON.stringify(counts, null, 2));
  await browser.close();
})();
