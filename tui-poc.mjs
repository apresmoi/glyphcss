// Quick proof-of-concept: glyphcss rasteriser writing to a terminal.
// Run with: node tui-poc.mjs   (Ctrl-C to exit)
//
// This is NOT a library — it's a one-file demo to validate that the rasteriser
// is DOM-agnostic enough to power a future @glyphcss/terminal package.

import { readFile } from "node:fs/promises";
import {
  buildRasterizeContext,
  createGlyphcssPerspectiveCamera,
  parseGltf,
  rasterize,
} from "./packages/glyphcss/dist/index.js";

// parseGltf mints URL.createObjectURL for embedded textures (browser API).
// We never read those URLs (we only use baseColorFactor), so a no-op is fine.
if (typeof globalThis.URL.createObjectURL !== "function") {
  globalThis.URL.createObjectURL = () => "blob:noop";
}

// ── 1. Load apple.glb and fan-triangulate. ────────────────────────────────
const buf = await readFile("./website/public/gallery/glb/apple.glb");
// targetSize: 2 + gridShift: -1 → mesh centered in [-1, 1] (camera targets origin).
const parsed = parseGltf(
  new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  { targetSize: 2, gridShift: -1 },
);

const triangles = [];
for (const poly of parsed.polygons) {
  const v = poly.vertices;
  if (v.length < 3) continue;
  for (let i = 1; i < v.length - 1; i++) {
    triangles.push({
      vertices: [v[0], v[i], v[i + 1]],
      uvs: [[0, 0], [0, 0], [0, 0]],
      ...(poly.color ? { color: poly.color } : {}),
    });
  }
}

// ── 2. Camera. ────────────────────────────────────────────────────────────
// `distance` is in pixel-space (compared against z * MESH_UNIT, where
// MESH_UNIT = 30). For a mesh in [-1, 1], max |zPx| = 30 — so distance must
// be much larger than 30 or vertices get NaN-culled / wildly over-projected.
const camera = createGlyphcssPerspectiveCamera({
  rotX: 0.3,
  rotY: 0,
  scale: 0.35,
  distance: 200,
});

// ── 3. Terminal lifecycle: alt screen + hide cursor, restore on exit. ─────
const enterTui = () => process.stdout.write("\x1b[?1049h\x1b[?25l");
const exitTui  = () => process.stdout.write("\x1b[?25h\x1b[?1049l");
process.on("SIGINT",  () => { exitTui(); process.exit(0); });
process.on("SIGTERM", () => { exitTui(); process.exit(0); });
process.on("exit", exitTui);
enterTui();

// ── 4. Render loop: rotate, rasterise, write ONE string per frame. ────────
const FPS = 30;
let tick = 0;

function frame() {
  const cols = Math.max(20, process.stdout.columns ?? 80);
  const rows = Math.max(10, (process.stdout.rows ?? 24) - 1);
  camera.rotY = tick * 0.05;
  camera.rotX = 0.3 + Math.sin(tick * 0.02) * 0.2;

  const ctx = buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect: 2.0 },
    triangles,
    mode: "solid",
    useColors: false,
  });
  const out = rasterize(ctx);

  process.stdout.write(
    "\x1b[H" + out +
    `\n apple.glb — ${triangles.length} tris — ${cols}×${rows} — frame ${tick} — Ctrl-C to quit`,
  );
  tick++;
}

setInterval(frame, 1000 / FPS);
