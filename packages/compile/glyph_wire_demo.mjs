/*
 * glyph_wire_demo.mjs — lock the Molty glyph-frame WIRE FORMAT + measure compression.
 *
 * Pipeline (host side):  scene -> glyphcss compileScene -> GlyphFrame -> bytes on wire
 * Pipeline (device side): bytes -> decode GlyphFrame -> rect-fill -> 412x412 RGB565
 *
 * We measure 3 wire encodings against the raw-pixel baseline, and round-trip each
 * back to a 412x412 image to prove the glyph grid is sufficient to reconstruct the
 * shaded picture the device shows.
 *
 *   baseline   raw RGB565 framebuffer .......... 412*412*2 = 339,488 B
 *   A) mono    glyph grid only (b&w intensity) .. cols*rows glyph bytes + header
 *   B) tint    glyph grid + 1 base color ........ same payload as mono + 3 B
 *   C) color   glyph grid + per-cell RGB ........ + cols*rows*3 B color plane
 *
 * Then gzip + brotli each, because ASCII grids are hugely run-compressible.
 */
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { icosahedronPolygons } from "@glyphcss/core";
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants as zc } from "node:zlib";

const OUT = process.argv[2];
const COLS = 48, ROWS = 48, PANEL = 412;
// glyphcss "ascii" palette solid ramp (darkest -> brightest). Device bakes this in.
const RAMP = " .,:;!+=*xX#@";
const BASE_HEX = "#7fd4ff";

// ── host: scene -> glyph frame ──────────────────────────────────────────────
const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1, color: BASE_HEX });
const res = compileScene({
  polygons: polys, autoCenter: true,
  camera: createGlyphOrthographicCamera({ rotX: 60, rotY: 30, zoom: 14 }),
  cols: COLS, rows: ROWS, cellAspect: 1,
  mode: "solid", glyphPalette: "ascii", useColors: true,
});

// parse coloured inner -> per-cell {ch, r,g,b}
const hexRgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const cells = [];
for (const line of res.inner.split("\n")) {
  const row = [];
  const re = /<span[^>]*color:(#[0-9a-fA-F]{6})[^>]*>([^<]*)<\/span>|([^<]+)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) { const c = hexRgb(m[1]); for (const ch of m[2]) row.push({ ch, r:c[0], g:c[1], b:c[2] }); }
    else if (m[3] !== undefined) { for (const ch of m[3]) row.push({ ch, r:0, g:0, b:0 }); }
  }
  cells.push(row);
}
const rows = cells.length, cols = Math.max(...cells.map(r => r.length));
// normalise to a dense cols*rows grid
const grid = Array.from({ length: rows }, (_, y) =>
  Array.from({ length: cols }, (_, x) => cells[y][x] || { ch: " ", r:0, g:0, b:0 }));

// ── WIRE ENCODINGS ──────────────────────────────────────────────────────────
// glyph text plane: rows joined by '\n' (1 byte/char for ascii palette)
const glyphText = grid.map(row => row.map(c => c.ch).join("")).join("\n");
const glyphBytes = Buffer.from(glyphText, "utf8");

// header: "GF1 <cols> <rows> <mode> <base>\n"  (mode: m=mono t=tint c=color)
const header = (mode) => Buffer.from(`GF1 ${cols} ${rows} ${mode} ${BASE_HEX}\n`, "utf8");

// color plane (mode C): per-cell RGB, row-major, 3 B/cell
const colorPlane = Buffer.alloc(rows * cols * 3);
for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i += 3) {
  colorPlane[i] = grid[y][x].r; colorPlane[i+1] = grid[y][x].g; colorPlane[i+2] = grid[y][x].b;
}

const wireMono  = Buffer.concat([header("m"), glyphBytes]);
const wireTint  = Buffer.concat([header("t"), glyphBytes]);            // base color in header
const wireColor = Buffer.concat([header("c"), glyphBytes, Buffer.from("\n"), colorPlane]);
const rawPixels = PANEL * PANEL * 2;

const gz = (b) => gzipSync(b, { level: 9 }).length;
const br = (b) => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length;

// ── DEVICE-SIDE DECODE (simulated in JS, this is the C contract) ─────────────
const enc565be = (r,g,b) => { const le = ((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3); return ((le>>8)|(le<<8))&0xFFFF; };
const rampIntensity = (ch) => { const i = RAMP.indexOf(ch); return i < 0 ? 0 : i/(RAMP.length-1); };
const base = hexRgb(BASE_HEX);

function decodeToImage(frameGrid, mode) {
  const rgb565 = Buffer.alloc(PANEL*PANEL*2);
  const png = new PNG({ width: PANEL, height: PANEL });
  const cpx = PANEL/cols, cpy = PANEL/rows;
  for (let y = 0; y < PANEL; y++) {
    const cy = Math.min(rows-1, Math.floor(y/cpy));
    for (let x = 0; x < PANEL; x++) {
      const cx = Math.min(cols-1, Math.floor(x/cpx));
      const cell = frameGrid[cy][cx];
      let r, g, b;
      if (mode === "color") { r = cell.r; g = cell.g; b = cell.b; }
      else {
        const t = rampIntensity(cell.ch);
        if (mode === "mono") { r = g = b = Math.round(255*t); }
        else { r = Math.round(base[0]*t); g = Math.round(base[1]*t); b = Math.round(base[2]*t); } // tint
      }
      const i = y*PANEL + x;
      rgb565.writeUInt16BE(enc565be(r,g,b), i*2);
      png.data[i*4]=r; png.data[i*4+1]=g; png.data[i*4+2]=b; png.data[i*4+3]=255;
    }
  }
  return { rgb565, png };
}

const truth = decodeToImage(grid, "color");
const mono  = decodeToImage(grid, "mono");
const tint  = decodeToImage(grid, "tint");

writeFileSync(`${OUT}/wire_truth_color.png`, PNG.sync.write(truth.png));
writeFileSync(`${OUT}/wire_recon_mono.png`,  PNG.sync.write(mono.png));
writeFileSync(`${OUT}/wire_recon_tint.png`,  PNG.sync.write(tint.png));
writeFileSync(`${OUT}/glyph_frame.gf1`, wireTint);

// ── REPORT ───────────────────────────────────────────────────────────────────
const ratio = (n) => (rawPixels / n).toFixed(0) + "x";
function line(name, buf) {
  const r = buf.length, g = gz(buf), b = br(buf);
  return `${name.padEnd(28)} raw ${String(r).padStart(7)}B (${ratio(r).padStart(5)})   gzip ${String(g).padStart(6)}B (${ratio(g).padStart(5)})   brotli ${String(b).padStart(5)}B (${ratio(b).padStart(6)})`;
}
console.log(`GlyphFrame wire-format demo — ${cols}x${rows} grid -> ${PANEL}x${PANEL} RGB565\n`);
console.log(`baseline raw RGB565 framebuffer .... ${rawPixels} B  (1x)\n`);
console.log(line("A) mono  (glyphs only)",  wireMono));
console.log(line("B) tint  (glyphs + base hex)", wireTint));
console.log(line("C) color (glyphs + RGB plane)", wireColor));
console.log(`\nglyph grid is ${glyphBytes.length} B of text; ramp ="${RAMP}"`);
console.log(`\nframe.txt preview (first 14 rows):`);
console.log(grid.slice(12,26).map(r=>r.map(c=>c.ch).join("")).join("\n"));
