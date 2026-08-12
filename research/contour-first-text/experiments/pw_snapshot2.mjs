import { chromium } from "playwright";
const url = process.argv[2];
const label = process.argv[3] || "snap";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `/tmp/wa2_${label}.png` });
await browser.close();
