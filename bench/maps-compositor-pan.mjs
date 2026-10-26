// Offline Node/happy-dom probe: dispatch + microtasks + one controlled motion
// frame per pointermove. This measures JS, not browser layout/paint/compositing.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
const root = new URL("../", import.meta.url).pathname;
const require = createRequire(new URL("../packages/maps/package.json", import.meta.url));
const { Window } = require("happy-dom");
const window = new Window({ url: "http://localhost" });
for (const k of Object.getOwnPropertyNames(window)) {
  if (!(k in globalThis) && !["window", "document", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(k)) {
    Object.defineProperty(globalThis, k, { configurable: true, get: () => window[k] });
  }
}
Object.assign(globalThis, { window, document: window.document, getComputedStyle: window.getComputedStyle.bind(window) });
let queued = new Map(), next = 0, now = 100;
globalThis.requestAnimationFrame = cb => { queued.set(++next, cb); return next; };
globalThis.cancelAnimationFrame = id => queued.delete(id);
const frame = () => { const callbacks = [...queued.values()]; queued.clear(); now += 16; for (const cb of callbacks) cb(now); };
const bundle = await build({
  stdin: { contents: `export {createGlyphMap} from './packages/maps/src/widget';
export {glyphMapGlobe, glyphMapEquirectangular} from './packages/maps/src/projection';
export {glyphMapDecodeMVT} from './packages/maps/src/vector/pmtiles';
export {glyphMapOpenMapTilesLayers} from './packages/maps/src/vector/openmaptiles';`, resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false,
  alias: { glyphcss: path.join(root, "packages/glyphcss/src/index.ts") },
});
const temp = mkdtempSync(path.join(tmpdir(), "maps-compositor-"));
try {
  writeFileSync(path.join(temp, "bundle.mjs"), bundle.outputFiles[0].text);
  const api = await import("file://" + path.join(temp, "bundle.mjs"));
  const fixture = path.join(root, "packages/maps/fixtures/road-relief/ba");
  const features = {};
  for (const name of readdirSync(fixture).filter(n => n.endsWith(".pbf"))) {
    const [, z, x, y] = /osm_(\d+)_(\d+)_(\d+)\.pbf/.exec(name);
    const layers = api.glyphMapDecodeMVT(readFileSync(path.join(fixture, name)), +z, +x, +y, ["water", "transportation", "building"]);
    for (const [key, value] of Object.entries(layers)) (features[key] ??= []).push(...value);
  }
  const layers = api.glyphMapOpenMapTilesLayers({}, { include: ["omt-water", "omt-roads", "omt-buildings"] })
    .map(layer => ({ ...layer, source: { features: features[layer.sourceLayer] ?? [] } }));
  const hosts = new Set();
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const probe = this.tagName === "PRE" && this.style.visibility === "hidden";
    const width = hosts.has(this) ? 1120 : probe ? 8 : 0;
    const height = hosts.has(this) ? 1008 : probe ? 16 * this.textContent.split("\n").length : 0;
    return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} };
  };
  let renders = 0;
  globalThis.__glyphRenderStage = stage => { if (stage === "base-validate") renders++; };
  const pointer = (host, type, x) => host.dispatchEvent(new window.PointerEvent(type, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: 400, bubbles: true }));
  const samples = [];
  // First pair is a small end-to-end pilot and warm-up; report subsequent runs.
  for (const moves of [10, 100, 100, 100]) for (const orbit of [false, true]) for (const compositorPan of [false, true]) {
    const host = document.createElement("div"); hosts.add(host); document.body.append(host);
    const map = api.createGlyphMap(host, {
      projection: orbit ? api.glyphMapGlobe() : api.glyphMapEquirectangular(),
      view: { center: [-58.3816, -34.6037], span: 0.045, cols: 140, rows: 63 },
      tilt: 40, compositorPan, snapPan: true, layers,
      scene: { charMode: "braille", useColors: true, colorEncoding: "spans" },
    });
    await map.idle();
    if (!/[^\s]/u.test(map.scene.output.textContent)) throw new Error("Blank fixture render");
    pointer(host, "pointerdown", 400);
    const costs = [], eventCosts = [], transformCosts = [];
    renders = 0;
    for (let i = 1; i <= moves; i++) {
      const before = renders, t = performance.now();
      pointer(host, "pointermove", 400 + i);
      eventCosts.push(performance.now() - t);
      await Promise.resolve(); frame(); await Promise.resolve();
      const cost = performance.now() - t; costs.push(cost);
      if (renders === before) transformCosts.push(cost);
    }
    const dragRenders = renders;
    pointer(host, "pointercancel", 400 + moves); frame(); await map.idle();
    const settled = map.scene.output.innerHTML; map.scene.rerender();
    if (map.scene.output.innerHTML !== settled || map.scene.output.parentElement.style.transform) throw new Error("Unsettled final render");
    if (moves === 100) samples.push({ projection: orbit ? "globe" : "sheet", compositorPan,
      jsMsPerMove: costs.reduce((a,b) => a+b,0) / moves,
      handlerMsPerMove: eventCosts.reduce((a,b) => a+b,0) / moves,
      transformOnlyMs: transformCosts.reduce((a,b) => a+b,0) / (transformCosts.length || 1),
      transformOnlyMoves: transformCosts.length, rendersPer100px: dragRenders });
    map.destroy(); host.remove(); hosts.delete(host); queued.clear();
  }
  const report = { fixture: "vendored BA z13 water/roads/buildings, no terrain; 140x63 braille, tilt40, snapPan; 1px/move", featureCounts: Object.fromEntries(Object.entries(features).map(([k,v]) => [k,v.length])), samples };
  console.log(JSON.stringify(report, null, 2));
} finally {
  globalThis.__glyphRenderStage = undefined;
  await window.happyDOM.close(); rmSync(temp, { recursive: true, force: true });
}
