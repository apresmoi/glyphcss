// Isolated glyphcss render bench.
//
// Renders one heavy mesh (default army.vox, the model that lagged on drag)
// through the LOCAL library source (../packages/*, esbuild-bundled so edits
// reflect on rebuild) with orbit controls, exposing the knobs that drive render
// cost: grid size (rows/cols — the line-height proxy), camera zoom (coverage),
// color mode. Perf is read from globalThis.__glyphPerf (raster / dom-write ms)
// and globalThis.__glyphPerfDetail (loop vs string-build ms), which the
// rasterizer records when those globals are set. The chrome-capture-trace skill
// (bench/run.mjs) drives drags on top and aligns Chrome Style/Layout/Paint.
//
// Readiness hook for the tracer: globalThis.__benchReady === true.

import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  createGlyphOrbitControls,
  loadMesh,
  bakeSolidTextureSamples,
} from "../packages/glyphcss/src/index";
import type { Polygon, Vec3 } from "../packages/core/src/index";

declare global {
  interface Window {
    __bench: unknown;
    __benchReady: boolean;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = parseFloat(q.get(k) ?? ""); return Number.isFinite(v) ? v : d; };

const lineHeight = num("lineHeight", 0.5);
const cols = Math.round(num("cols", 184));
const rows = Math.round(num("rows", 127));
const rotX = num("rotX", 60);
const rotY = num("rotY", 45);
const fill = num("fill", 0.82);          // fraction of the grid the model should span
const zoomParam = q.get("zoom");          // explicit zoom overrides auto-fit
const meshUrl = q.get("mesh") ?? "/website/public/gallery/vox/army.vox";
const useColors = q.get("colors") !== "0";

const host = document.getElementById("host") as HTMLElement;
host.style.lineHeight = String(lineHeight);
const hud = document.getElementById("hud") as HTMLElement;

// ── Normalize mesh to a unit, origin-centered bbox so zoom math is stable ──
function normalizeUnit(polys: Polygon[]): Polygon[] {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const v of p.vertices) for (let i = 0; i < 3; i++) {
    if (v[i] < min[i]) min[i] = v[i];
    if (v[i] > max[i]) max[i] = v[i];
  }
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = 1 / ext;
  return polys.map((p) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [(x - c[0]) * s, (y - c[1]) * s, (z - c[2]) * s] as Vec3),
  }));
}

// Used-cell extent of the current render, to auto-fit zoom to `fill`.
function usedExtent(): { w: number; h: number } {
  const lines = (scene.output.textContent ?? "").split("\n");
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let cI = 0; cI < line.length; cI++) {
      if (line[cI] !== " ") { if (cI < minC) minC = cI; if (cI > maxC) maxC = cI; if (r < minR) minR = r; if (r > maxR) maxR = r; }
    }
  }
  if (maxC < minC) return { w: 1, h: 1 };
  return { w: maxC - minC + 1, h: maxR - minR + 1 };
}

const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 50 });
const scene = createGlyphScene(host, {
  mode: "solid",
  useColors,
  cols, rows,
  cellAspect: 2.0,
  camera,
  directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.1 },
  ambientLight: { intensity: 0.45 },
});

(globalThis as Record<string, unknown>).__glyphPerf = { raster: [], dom: [], polys: [] };

const res = await loadMesh(meshUrl);
const baked = await bakeSolidTextureSamples(res, { colorTolerance: 255 });
const polys = normalizeUnit(baked.polygons);
scene.add(polys);

// Auto-fit zoom (one linear correction step; ortho zoom scales projection linearly).
if (zoomParam !== null) {
  camera.zoom = parseFloat(zoomParam);
  scene.rerender();
} else {
  scene.rerender();
  const u = usedExtent();
  const k = Math.min((cols * fill) / u.w, (rows * fill) / u.h);
  camera.zoom = camera.zoom * k;
  scene.rerender();
}

const controls = createGlyphOrbitControls(scene, { clampPitch: false });

window.__bench = { scene, camera, controls, polys: polys.length };
window.__benchReady = true;

hud.textContent =
  `polys=${polys.length}\n` +
  `grid=${cols}x${rows}  lh=${lineHeight}  zoom=${camera.zoom.toFixed(1)}\n` +
  `colors=${useColors}\n` +
  `drag to rotate`;
