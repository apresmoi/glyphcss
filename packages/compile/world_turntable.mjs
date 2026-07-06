/*
 * world_turntable.mjs — bake N rotation frames of the glyphcss globe as GF1.
 * Writes <outdir>/frame_000.gf1.json .. frame_<N-1>.gf1.json (color mode).
 */
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
const N = Number(process.env.N ?? 36);        // frames over 360°
const G = Number(process.env.G ?? 64);        // grid (square)
const ROTX = Number(process.env.ROTX ?? -25);
const ZOOM = Number(process.env.ZOOM ?? 35);  // ~fills the round panel at G=64
const earth = JSON.parse(readFileSync("/Users/apresmoi/glyphcss/website/public/data/earth.json", "utf8"));
const hexRgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];

for (let f = 0; f < N; f++) {
  const rotY = (f * 360) / N;
  const res = compileScene({
    polygons: earth, autoCenter: true,
    camera: createGlyphOrthographicCamera({ rotX: ROTX, rotY, zoom: ZOOM }),
    cols: G, rows: G, cellAspect: 1, mode: "solid", glyphPalette: "ascii", useColors: true,
  });
  const cells = [];
  for (const line of res.inner.split("\n")) {
    const row = []; const re = /<span[^>]*color:(#[0-9a-fA-F]{6})[^>]*>([^<]*)<\/span>|([^<]+)/g; let m;
    while ((m = re.exec(line))) {
      if (m[1] !== undefined) { const c = hexRgb(m[1]); for (const ch of m[2]) row.push(c); }
      else if (m[3] !== undefined) { for (const ch of m[3]) row.push([0,0,0]); }
    }
    cells.push(row);
  }
  const rows = cells.length, cols = Math.max(...cells.map(r => r.length));
  let colors = "";
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const c = cells[y][x] || [0,0,0];
    colors += ((1<<24) + (c[0]<<16) + (c[1]<<8) + c[2]).toString(16).slice(1);
  }
  const payload = JSON.stringify({ cols, rows, mode: "c", colors });
  writeFileSync(`${OUT}/frame_${String(f).padStart(3,"0")}.gf1.json`, payload);
}
console.log(`baked ${N} frames @ ${G}x${G} → ${OUT}`);
