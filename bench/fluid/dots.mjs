// Dot-geometry comparison: screenshot + per-dot measurements. node dots.mjs <out.png>
import { chromium } from "playwright";
const [out = "dots.png"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 900, height: 140 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.error(e.message));
await p.goto("http://127.0.0.1:4361/dots.html");
await p.waitForFunction(() => window.__dots, null, { timeout: 30000 });
const d = await p.evaluate(() => window.__dots);
await p.screenshot({ path: out });
const f = (x) => x.toFixed(3);
console.log(`advance ${f(d.advanceEm)} em, font-size ${d.fontSize.toFixed(2)} px, font line box ${f(d.lineBox)} em, cell ${d.cell.w}×${d.cell.h}`);
console.log("dot  canvas cx,cy  w×h        atlas cx,cy  w×h   (cell fractions)");
for (let i = 0; i < Math.max(d.canvas.length, d.atlas.length); i++) {
  const a = d.canvas[i], g = d.atlas[i];
  console.log(`${i}    ${a ? `${f(a.cx)},${f(a.cy)}  ${f(a.w)}×${f(a.h)}` : "-"}    ${g ? `${f(g.cx)},${f(g.cy)}  ${f(g.w)}×${f(g.h)}` : "-"}`);
}
await b.close();
