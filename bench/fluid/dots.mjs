// Dot geometry: the reference's canvas vs the fluid's two atlas faces as real DOM text.
// node dots.mjs <out.png> [out.json]
// Screenshots each panel element (device pixels, DPR 2), decodes the PNGs in the page and
// reports per-dot geometry of ⣿ over ⣿, the dot pitch and edge gap inside a cell vs across
// the cell boundary, and a binarised pixel comparison of each DOM panel against the canvas.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const [out = "dots.png", json] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 840, height: 400 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.error(e.message));
await p.goto(`http://127.0.0.1:${process.env.FLUID_BENCH_PORT ?? 4361}/dots.html`);
await p.waitForFunction(() => window.__dots, null, { timeout: 30000 });
const meta = await p.evaluate(() => window.__dots);
const pngs = {};
for (const id of ["canvas", "universal", "dots"]) pngs[id] = (await p.locator(`#${id}`).screenshot()).toString("base64");
const r = await p.evaluate((x) => window.__analyse(x), pngs);
await p.screenshot({ path: out, fullPage: true });
const f = (x) => x.toFixed(3);
console.log(`advance: universal ${f(meta.advance.universal)} em, dots ${f(meta.advance.dots)} em; cell ${meta.cell.w}×${meta.cell.h} px, dpr ${meta.dpr}`);
console.log("dot  canvas cx,cy  w×h          universal cx,cy  w×h       dots cx,cy  w×h   (cell fractions, top cell)");
for (let i = 0; i < 8; i++) {
  const row = ["canvas", "universal", "dots"].map((k) => {
    const d = r[k].dots.filter((d) => d.cy < 1)[i];
    return d ? `${f(d.cx)},${f(d.cy)}  ${f(d.w)}×${f(d.h)}` : "-".padEnd(24);
  });
  console.log(`${i}    ${row.join("    ")}`);
}
console.log("spacing (cell heights)   pitch in-cell / across    gap in-cell / across");
for (const k of ["canvas", "universal", "dots"]) {
  const s = r[k].spacing;
  console.log(`${k.padEnd(24)} ${f(s.inCellPitch)} / ${f(s.crossPitch)}            ${f(s.inCellGap)} / ${f(s.crossGap)}   `);
}
for (const k of ["universal", "dots"]) {
  const px = r[k].pixels;
  console.log(`pixels ${k} vs canvas: same size ${px.sameSize}, IoU ${f(px.iou)}, differing ${px.differing} of ${px.inked} inked px`);
}
if (json) writeFileSync(json, JSON.stringify({ meta, ...r }, null, 1));
await b.close();
