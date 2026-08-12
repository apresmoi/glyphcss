import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => console.log("PAGE:", msg.text()));
await page.goto("http://localhost:4323/wordart?text=Hi&tilt=0&turn=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const pre = document.querySelector(".wa-stage pre");
  const stage = document.querySelector(".wa-stage");
  return {
    preRows: pre ? pre.textContent.split("\n").length : null,
    preCols: pre ? Math.max(...pre.textContent.split("\n").map(l=>l.length)) : null,
    stageW: stage?.clientWidth, stageH: stage?.clientHeight,
    fontSize: pre ? getComputedStyle(pre).fontSize : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
