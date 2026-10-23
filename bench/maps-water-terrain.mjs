// Local, offline pointer-drag probe over the vendored Venice fixtures.
// Event-loop gaps are a Node surrogate, including GC/scheduling and rendering;
// they are not browser Long Task API entries. Installation is timed separately.
// --baseline=<git-ref> bundles the four changed implementation files at that ref.
// --water=off removes the water row, matching the no-water control.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
const require = createRequire(
  new URL("../packages/maps/package.json", import.meta.url),
);
const { Window } = require("happy-dom");
const w = new Window({ url: "http://localhost" });
for (const k of Object.getOwnPropertyNames(w))
  if (
    !(k in globalThis) &&
    ![
      "window",
      "document",
      "getComputedStyle",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ].includes(k)
  )
    Object.defineProperty(globalThis, k, {
      configurable: true,
      get: () => w[k],
    });
Object.assign(globalThis, {
  window: w,
  document: w.document,
  getComputedStyle: w.getComputedStyle.bind(w),
});
w.addEventListener("error", (e) => {
  throw e.error ?? new Error(e.message);
});
const tasks = [];

globalThis.requestAnimationFrame = (cb) =>
  w.requestAnimationFrame((t) => {
    const s = performance.now();
    try {
      cb(t);
    } finally {
      tasks.push({ kind: "frame", ms: performance.now() - s });
    }
  });
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
const rootDir = new URL("../", import.meta.url).pathname;
process.chdir(rootDir);
const baseline = process.argv
  .find((arg) => arg.startsWith("--baseline="))
  ?.slice(11);
const waterOff = process.argv.includes("--water=off");
const workCosts = [];
const terrainCounts = new Map();
globalThis.__waterGeometry = (tile, polygons) => terrainCounts.set(tile, polygons.reduce((n, p) => n + Math.max(0, p.vertices.length - 2), 0));
let partitionCpuMs = 0;
globalThis.__waterMeasure = (kind, ms) => {
  if (kind === "partition-step") partitionCpuMs += ms;
  else workCosts.push({ kind, ms });
};
const instrument = {
  name: "water-measure",
  setup(build) {
    build.onLoad(
      { filter: /\/(widget|mesh|layers|waterTerrain)\.ts$/ },
      (args) => {
        if (!args.path.startsWith(path.join(rootDir, "packages/maps/src/")))
          return;
        let contents = baseline
          ? execFileSync(
              "git",
              ["show", `${baseline}:${path.relative(rootDir, args.path)}`],
              { encoding: "utf8" },
            )
          : readFileSync(args.path, "utf8");
        if (args.path.endsWith("/widget.ts")) {
          contents = contents.replace(
            "if (!prepared.commit()) continue;",
            'const started = performance.now(); const committed = prepared.commit(); (globalThis as any).__waterMeasure("install",performance.now()-started); if (!committed) continue;',
          );
          contents = contents.replace(
            "rebuild(commitWater(tiles as GlyphMapVectorTile[]));",
            'const started = performance.now(); rebuild(commitWater(tiles as GlyphMapVectorTile[])); (globalThis as any).__waterMeasure("sync-commit-with-render",performance.now()-started);',
          );
          contents = contents.replace(
            "rebuild(filter ? selected.filter(filter) : selected);",
            'const started = performance.now(); rebuild(filter ? selected.filter(filter) : selected); (globalThis as any).__waterMeasure("legacy-build-with-render",performance.now()-started);',
          );
        }
        if (args.path.endsWith("/mesh.ts")) {
          const start = contents.indexOf("export function* prepareGlyphMapTerrainPolygons");
          const finish = contents.indexOf("  return result;", start);
          if (start < 0 || finish < 0) throw new Error("Terrain instrumentation target missing");
          contents = contents.slice(0, finish) + '(globalThis as any).__waterGeometry(tile,result);\n' + contents.slice(finish);
        }
        if (args.path.endsWith("/waterTerrain.ts")) {
          contents = contents.replace("export function* partitionGlyphMapWaterTerrainSteps(", "function* unmeasuredPartitionGlyphMapWaterTerrainSteps(");
          contents += `
export function* partitionGlyphMapWaterTerrainSteps(...args: Parameters<typeof unmeasuredPartitionGlyphMapWaterTerrainSteps>): Generator<void, ReturnType<typeof unmeasuredPartitionGlyphMapWaterTerrainSteps> extends Generator<void, infer R> ? R : never> {
  const steps = unmeasuredPartitionGlyphMapWaterTerrainSteps(...args);
  for (;;) {
    const started = performance.now();
    const next = steps.next();
    (globalThis as any).__waterMeasure("partition-step", performance.now() - started);
    if (next.done) return next.value;
    yield;
  }
}`;
          contents = contents.replace(
            "let deadline = performance.now();",
            "let deadline = performance.now(); let measuredStart = deadline;",
          );
          contents = contents.replace(
            "await new Promise<void>(resolve => setTimeout(resolve, 0));",
            '(globalThis as any).__waterMeasure("prepare-slice",performance.now()-measuredStart); await new Promise<void>(resolve => setTimeout(resolve, 0)); measuredStart=performance.now();',
          );
          contents = contents.replace(
            "if (next.done) return next.value;",
            'if (next.done) { (globalThis as any).__waterMeasure("prepare-slice",performance.now()-measuredStart); return next.value; }',
          );
        }
        return { contents, loader: "ts" };
      },
    );
  },
};
const result = await build({
  stdin: {
    contents: `export { createGlyphMap } from './packages/maps/src/widget';
export { glyphMapGlobe } from './packages/maps/src/projection';
export { glyphMapBreaks } from './packages/maps/src/classify';
export { glyphMapDecodeGeoTileInt16 } from './packages/maps/src/tile';
export { glyphMapDecodeMVT } from './packages/maps/src/vector/pmtiles';
export { glyphMapMercatorTileBounds } from './packages/maps/src/vector/mercator';
export { glyphMapOpenMapTilesLayers } from './packages/maps/src/vector/openmaptiles';`,
    resolveDir: rootDir,
    loader: "ts",
  },
  plugins: [instrument],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { glyphcss: path.join(rootDir, "packages/glyphcss/src/index.ts") },
});
const temp = mkdtempSync(path.join(tmpdir(), "glyph-water-"));
writeFileSync(path.join(temp, "bundle.mjs"), result.outputFiles[0].text);
const api = await import("file://" + path.join(temp, "bundle.mjs"));
const root = "packages/maps/fixtures/openfreemap/venice/";
const ground = api.glyphMapDecodeGeoTileInt16(
  readFileSync(root + "terrain-4-8-3.bin"),
  {
    bounds: { west: 0, east: 22.5, south: 45, north: 56.25 },
    cols: 180,
    rows: 90,
    source: "ETOPO1",
    sampler: "bilinear",
  },
);
const hosts = new Set();
w.Element.prototype.getBoundingClientRect = function () {
  const probe = this.tagName === "PRE" && this.style.visibility === "hidden",
    k = (parseFloat(this.style.fontSize) || 16) / 16;
  const width = hosts.has(this) ? 138 * 8 : probe ? 8 * k : 0,
    height = hosts.has(this)
      ? 77 * 16
      : probe
        ? 16 * k * (this.textContent ?? "").split("\n").length
        : 0;
  return {
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON() {
      return {};
    },
  };
};
const commits = [];
for (const [z, x, y] of [
  [8, 136, 91],
  [10, 547, 366],
  [12, 2188, 1466],
]) {
  const bounds = api.glyphMapMercatorTileBounds(z, x, y),
    tile = {
      z,
      x,
      y,
      bounds,
      source: "fixture",
      simplify: "mvt-source",
      layers: api.glyphMapDecodeMVT(
        readFileSync(root + `${z}_${x}_${y}.pbf`),
        z,
        x,
        y,
        ["water"],
      ),
    };
  terrainCounts.clear();
  let release;
  const pending = new Promise((r) => (release = r));
  const provider = {
    id: "fixture",
    zooms: [
      {
        z,
        cols: 2 ** z,
        rows: 2 ** z,
        tileLonSpan: 360 / 2 ** z,
        tileLatSpan: 180 / 2 ** z,
        tileCols: 256,
        tileRows: 256,
      },
    ],
    bounds: api.glyphMapMercatorTileBounds,
    tileRange: () => ({ x0: x, x1: x, y0: y, y1: y }),
    loadTile: () => pending,
  };
  const host = document.createElement("div");
  document.body.append(host);
  hosts.add(host);
  const map = api.createGlyphMap(host, {
    view: { center: [12.3376, 45.4394], span: 1.1, cols: 138, rows: 77 },
    projection: api.glyphMapGlobe({ exaggeration: 24 }),
    tilt: 0,
    layers: [
      {
        type: "raster",
        source: ground,
        minElevation: 0,
        classifier: api.glyphMapBreaks([0]),
        colors: ["#2a55a8", "#2f5a36"],
      },
      ...(waterOff ? [] : api.glyphMapOpenMapTilesLayers(provider, {
        include: ["omt-water"],
        waterTerrain: true,
      })),
    ],
    scene: {
      mode: "solid",
      useColors: true,
      colorEncoding: "spans",
      ambientLight: { intensity: 1, color: "#ffffff" },
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
    },
  });
  // Finish initial terrain frames before the measured drag.
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
  tasks.length = 0;
  workCosts.length = 0;
  partitionCpuMs = 0;
  let probing = true,
    lastProbe = performance.now();
  const probe = () => {
    if (!probing) return;
    const now = performance.now();
    if (now - lastProbe > 1)
      tasks.push({ kind: "event-loop-gap", ms: now - lastProbe });
    lastProbe = now;
    setImmediate(probe);
  };
  setImmediate(probe);
  const output = map.scene.output;
  output.dispatchEvent(
    new w.PointerEvent("pointerdown", {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 550,
      clientY: 610,
      bubbles: true,
    }),
  );
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    output.dispatchEvent(
      new w.PointerEvent("pointermove", {
        pointerId: 1,
        buttons: 1,
        clientX: 550 - i * 2,
        clientY: 610 - i,
        bubbles: true,
      }),
    );
    if (i === 3) release(tile);
    await new Promise((r) => setImmediate(r));
    tasks.push({
      kind: i === 3 ? "tile-commit-turn" : "input",
      ms: performance.now() - start,
    });
    await new Promise((r) => requestAnimationFrame(r));
  }
  output.dispatchEvent(
    new w.PointerEvent("pointerup", {
      pointerId: 1,
      button: 0,
      buttons: 0,
      bubbles: true,
    }),
  );
  await map.idle();
  await new Promise((resolve) => setImmediate(resolve));
  probing = false;
  if (map.getView().center.every((v, i) => v === [12.3376, 45.4394][i]))
    throw new Error("Pointer drag did not move the map");
  if (!map.scene.output.textContent?.trim())
    throw new Error("No rendered map after commit");
  if (
    !waterOff &&
    !workCosts.some((item) => /install|sync-commit|legacy-build/.test(item.kind))
  )
    throw new Error("No successful tile commit measured");

  // Isolate settled per-frame geometry cost from cooperative preparation and
  // event-loop scheduling. Each sample changes the camera and renders once.
  const renderTimes = [];
  const rotY = map.scene.camera.rotY;
  for (let i = 0; i < 35; i++) {
    map.scene.camera.rotY = rotY + (i + 1) * 0.005;
    const start = performance.now();
    map.scene.rerender();
    if (i >= 5) renderTimes.push(performance.now() - start);
  }
  map.scene.camera.rotY = rotY;
  renderTimes.sort((a, b) => a - b);

  const terrainTriangles = [...terrainCounts.values()].reduce((n, count) => n + count, 0);
  const initialWorkCosts = [...workCosts];
  const initialPartitionMs = +partitionCpuMs.toFixed(2);
  const bucketChanges = [];
  for (const span of [1.1 * 2 ** .25, 1.1, 1.10001]) {
    workCosts.length = 0;
    partitionCpuMs = 0;
    const started = performance.now();
    map.setView({ span });
    await map.idle();
    bucketChanges.push({ span, wallMs: +(performance.now() - started).toFixed(2),
      partitionMs: +partitionCpuMs.toFixed(2),
      prepareCpuMs: +workCosts.filter(v => v.kind === "prepare-slice").reduce((n, v) => n + v.ms, 0).toFixed(2),
      terrainTriangles: [...terrainCounts.values()].reduce((n, count) => n + count, 0),
    });
  }
  const commit = tasks.find((t) => t.kind === "tile-commit-turn").ms;
  const max = Math.max(...tasks.map((t) => t.ms));
  const costs = Object.fromEntries(
    [...new Set(initialWorkCosts.map((v) => v.kind))].map((kind) => [
      kind,
      +initialWorkCosts.filter(v => v.kind === kind).reduce((max, v) => Math.max(max, v.ms), 0).toFixed(2),
    ]),
  );
  const row = {
    z,
    terrainTriangles,
    initialPartitionMs,
    bucketChanges,
    costs,
    commitTurnMs: +commit.toFixed(2),
    maxTaskMs: +max.toFixed(2),
    over50msGaps: tasks.filter((t) => t.kind === "event-loop-gap" && t.ms > 50)
      .length,
    settledRenderMs: {
      samples: renderTimes.length,
      median: +renderTimes[Math.floor(renderTimes.length / 2)].toFixed(2),
      p95: +renderTimes[Math.ceil(renderTimes.length * 0.95) - 1].toFixed(2),
      max: +renderTimes[renderTimes.length - 1].toFixed(2),
    },
    top: tasks.sort((a, b) => b.ms - a.ms).slice(0, 5),
  };
  commits.push(row);
  console.log(JSON.stringify(row));
  map.destroy();
  host.remove();
  hosts.delete(host);
}
console.log(
  JSON.stringify({
    baseline: baseline ?? "working-tree",
    water: waterOff ? "off" : "on",
    measurements: commits,
  }),
);
await w.happyDOM.close();
rmSync(temp, { recursive: true, force: true });
