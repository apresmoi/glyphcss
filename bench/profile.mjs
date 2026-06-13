// Per-render phase profiler. Drives a drag and reports where each render's time
// goes, from globalThis.__glyphPerfDetail (loop = shade+scan-fill) and
// __glyphPerf (dom = innerHTML write). Use to spot regressions in the render
// path. Conditions sweep grid weight (line-height proxy) and zoom (coverage).
import { chromium } from "playwright";

const CONDITIONS = [
  { label: "light  (fill .95)", qs: "lineHeight=0.5&fill=0.95" },
  { label: "heavy  (zoom 200)", qs: "lineHeight=0.5&fill=0.99&zoom=200" },
];

const stat = (a) => {
  if (!a || !a.length) return { avg: 0, sum: 0 };
  const sum = a.reduce((x, y) => x + y, 0);
  return { avg: +(sum / a.length).toFixed(2), sum: +sum.toFixed(0) };
};

const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1440, height: 900 });

console.log("=== render phase profile (army.vox, ~120-step drag, per-render avg ms) ===\n");
for (const c of CONDITIONS) {
  await p.goto(`http://localhost:5180/bench/index.html?${c.qs}`, { waitUntil: "load" });
  await p.waitForFunction(() => window.__benchReady === true, { timeout: 20000 });
  // warm the shading cache with a full rotation, then measure steady state
  await p.evaluate(() => { const { scene, camera } = window.__bench; for (let i = 0; i < 60; i++) { camera.rotY = i * 6; camera.rotX = 40 + 20 * Math.sin(i / 9); scene.rerender(); } });
  await p.evaluate(() => { globalThis.__glyphPerf = { raster: [], dom: [], polys: [] }; globalThis.__glyphPerfDetail = { loop: [], string: [] }; });
  const box = await p.evaluate(() => { const r = document.getElementById("host").getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
  await p.mouse.move(box.cx, box.cy);
  await p.mouse.down();
  for (let i = 0; i < 120; i++) { const a = i * 0.32; await p.mouse.move(box.cx + Math.cos(a) * 140, box.cy + Math.sin(a) * 70); }
  await p.mouse.up();
  await p.waitForTimeout(150);
  const { perf, detail } = await p.evaluate(() => ({ perf: globalThis.__glyphPerf, detail: globalThis.__glyphPerfDetail }));
  const loop = stat(detail.loop), str = stat(detail.string), dom = stat(perf.dom);
  console.log(`${c.label}   polys=${perf.polys.at(-1)}  renders=${detail.loop.length}`);
  console.log(`  loop ${String(loop.avg).padStart(5)}ms   string ${String(str.avg).padStart(5)}ms   dom ${String(dom.avg).padStart(5)}ms   total ≈ ${(loop.avg + str.avg + dom.avg).toFixed(2)}ms\n`);
}
await b.close();
