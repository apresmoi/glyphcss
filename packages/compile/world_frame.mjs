/*
 * world_frame.mjs — render the glyphcss ETOPO world globe to a Molty GF1 frame.
 *
 * Loads the pre-baked globe (website/public/data/earth.json), compiles it to an
 * ASCII glyph grid via glyphcss, and emits:
 *   preview_world.png   412x412 colour preview (what the round LCD shows)
 *   world.gf1.json      creature payload {cols,rows,mode,base,glyphs,colors}
 */
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const OUT = process.argv[2];
const N = Number(process.env.N ?? 96);          // grid (square — round LCD)
const PANEL = 412;
const ROTX = Number(process.env.ROTX ?? -25);
const ROTY = Number(process.env.ROTY ?? 120);
const ZOOM = Number(process.env.ZOOM ?? 190);
const RAMP = " .,:;!+=*xX#@";

const earth = JSON.parse(readFileSync(
  "/Users/apresmoi/glyphcss/website/public/data/earth.json", "utf8"));

const res = compileScene({
  polygons: earth, autoCenter: true,
  camera: createGlyphOrthographicCamera({ rotX: ROTX, rotY: ROTY, zoom: ZOOM }),
  cols: N, rows: N, cellAspect: 1,
  mode: "solid", glyphPalette: "ascii", useColors: true,
});

const hexRgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const cells = [];
for (const line of res.inner.split("\n")) {
  const row = []; const re = /<span[^>]*color:(#[0-9a-fA-F]{6})[^>]*>([^<]*)<\/span>|([^<]+)/g; let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) { const c = hexRgb(m[1]); for (const ch of m[2]) row.push({ ch, r:c[0], g:c[1], b:c[2] }); }
    else if (m[3] !== undefined) { for (const ch of m[3]) row.push({ ch, r:0,g:0,b:0 }); }
  }
  cells.push(row);
}
const rows = cells.length, cols = Math.max(...cells.map(r => r.length));
const grid = Array.from({length: rows}, (_, y) =>
  Array.from({length: cols}, (_, x) => cells[y][x] || { ch:" ", r:0,g:0,b:0 }));

// preview
const png = new PNG({ width: PANEL, height: PANEL });
const cpx = PANEL/cols, cpy = PANEL/rows;
for (let y = 0; y < PANEL; y++) {
  const cy = Math.min(rows-1, Math.floor(y/cpy));
  for (let x = 0; x < PANEL; x++) {
    const cx = Math.min(cols-1, Math.floor(x/cpx));
    const c = grid[cy][cx]; const i = y*PANEL + x;
    png.data[i*4]=c.r; png.data[i*4+1]=c.g; png.data[i*4+2]=c.b; png.data[i*4+3]=255;
  }
}
writeFileSync(`${OUT}/preview_world.png`, PNG.sync.write(png));

// GF1 creature payload (color mode): glyphs + per-cell RGB hex plane
const glyphs = grid.map(r => r.map(c => c.ch).join("")).join("\n");
let colors = "";
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  const c = grid[y][x];
  colors += ((1<<24) + (c.r<<16) + (c.g<<8) + c.b).toString(16).slice(1);
}
const payload = JSON.stringify({ cols, rows, mode: "c", base: "#000000", glyphs, colors });
writeFileSync(`${OUT}/world.gf1.json`, payload);

const litCells = grid.flat().filter(c => c.ch !== " ").length;
console.log(`world ${cols}x${rows}, ${litCells} lit cells`);
console.log(`payload ${payload.length} B  (gzip ${gzipSync(Buffer.from(payload)).length} B)`);
console.log(grid.map(r => r.map(c => c.ch).join("")).join("\n"));
