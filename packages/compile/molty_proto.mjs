/*
 * molty_proto.mjs — prototype: glyphcss ASCII frame -> 412x412 RGB565 bytemap.
 *
 * Proves the pipeline Juan asked about: glyphcss compile -> per-cell grid ->
 * intensity/colour bytemap that the Molty 1.46 LCD (412x412, RGB565) can blit.
 *
 * Emits, into the dir given as argv[2]:
 *   frame.txt        the raw ASCII grid (what glyphcss "compile" gives you)
 *   preview_rgb.png  412x412 colour preview (what the screen would show)
 *   preview_bw.png   412x412 b&w intensity preview (0..255 luma)
 *   frame_rgb565.bin big-endian RGB565, 412*412*2 bytes — device-ready blob
 *   grid.json        {cols,rows, cells:[{ch,r,g,b,intensity}...]} for the firmware
 */
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { icosahedronPolygons } from "@glyphcss/core";
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2];
const COLS = 48, ROWS = 48;          // ASCII grid resolution
const PANEL = 412;                    // device panel px (square)

// 1. geometry + render. cellAspect:1 => square cells (LCD blocks are square).
const rotX = Number(process.env.ROTX ?? 60);
const rotY = Number(process.env.ROTY ?? 30);
const zoom = Number(process.env.ZOOM ?? 12);
const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#7fd4ff" });
const res = compileScene({
  polygons: polys,
  autoCenter: true,
  camera: createGlyphOrthographicCamera({ rotX, rotY, zoom }),
  cols: COLS, rows: ROWS, cellAspect: 1,
  mode: "solid", glyphPalette: "ascii",
  useColors: true,
});

// 2. parse the coloured inner HTML into a per-cell grid.
//    Spans look like: <span style="color:#rrggbb">chars</span>, rows split by \n.
const cells = []; // [row][col] = {ch, r,g,b}
function hexToRgb(h) {
  const n = h.replace("#", "");
  return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
}
for (const line of res.inner.split("\n")) {
  const row = [];
  // walk spans + bare text
  const re = /<span[^>]*color:(#[0-9a-fA-F]{6})[^>]*>([^<]*)<\/span>|([^<]+)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) {            // coloured span
      const [r,g,b] = hexToRgb(m[1]);
      for (const ch of m[2]) row.push({ ch, r, g, b });
    } else if (m[3] !== undefined) {     // bare text (uncoloured -> background)
      for (const ch of m[3]) row.push({ ch, r: 0, g: 0, b: 0 });
    }
  }
  cells.push(row);
}
const rows = cells.length;
const cols = Math.max(...cells.map(r => r.length));

// 3. build buffers. RGB565 big-endian to match firmware's rgb565_be().
const rgb565 = Buffer.alloc(PANEL * PANEL * 2);
const pngRgb = new PNG({ width: PANEL, height: PANEL });
const pngBw  = new PNG({ width: PANEL, height: PANEL });
const enc565be = (r,g,b) => {
  const le = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
  return ((le >> 8) | (le << 8)) & 0xFFFF; // byte-swap -> big-endian
};
const cellPx = PANEL / cols;            // float; floor when indexing
const cellPy = PANEL / rows;
const txtRows = [];
for (let y = 0; y < PANEL; y++) {
  const cy = Math.min(rows - 1, Math.floor(y / cellPy));
  for (let x = 0; x < PANEL; x++) {
    const cx = Math.min(cols - 1, Math.floor(x / cellPx));
    const c = cells[cy][cx] || { r:0,g:0,b:0,ch:" " };
    const lum = Math.round(0.299*c.r + 0.587*c.g + 0.114*c.b);
    const i = (y * PANEL + x);
    rgb565.writeUInt16BE(enc565be(c.r, c.g, c.b), i*2);
    pngRgb.data[i*4+0]=c.r; pngRgb.data[i*4+1]=c.g; pngRgb.data[i*4+2]=c.b; pngRgb.data[i*4+3]=255;
    pngBw.data[i*4+0]=lum; pngBw.data[i*4+1]=lum; pngBw.data[i*4+2]=lum; pngBw.data[i*4+3]=255;
  }
}
for (const row of cells) txtRows.push(row.map(c => c.ch).join(""));

writeFileSync(`${OUT}/frame.txt`, txtRows.join("\n"));
writeFileSync(`${OUT}/frame_rgb565.bin`, rgb565);
writeFileSync(`${OUT}/preview_rgb.png`, PNG.sync.write(pngRgb));
writeFileSync(`${OUT}/preview_bw.png`, PNG.sync.write(pngBw));
writeFileSync(`${OUT}/grid.json`, JSON.stringify({
  cols, rows,
  cells: cells.flatMap((row,ry) => row.map((c,cx) => ({
    x: cx, y: ry, ch: c.ch, r: c.r, g: c.g, b: c.b,
    intensity: Math.round(0.299*c.r + 0.587*c.g + 0.114*c.b),
  }))),
}));
console.log(`grid ${cols}x${rows} -> ${PANEL}x${PANEL} RGB565 (${rgb565.length} bytes)`);
console.log(txtRows.join("\n"));
