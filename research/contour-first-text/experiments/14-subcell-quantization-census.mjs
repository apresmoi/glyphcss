// Extends 11-line-glyph-census.mjs: measure EVERY candidate for finer
// horizontal-row / vertical-column sub-cell quantization (already-shipped +
// new candidates from Block Elements) on ONE consistent scale, so level sets
// are chosen by measured centroid, not assumption. Throwaway.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
const FONT = process.env.FONT ?? "Menlo";
const S = 64;
const cv = createCanvas(S, Math.round(S * 2));
const ctx = cv.getContext("2d");

function measure(cp) {
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.font = `${S}px "${FONT}"`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String.fromCodePoint(cp), 0, S * 1.5);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, sx = 0, sy = 0, pts = [];
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const a = d[(y * cv.width + x) * 4 + 3];
    if (a > 96) { n++; sx += x; sy += y; pts.push([x, y]); }
  }
  if (n === 0) return null;
  const cx = sx / n, cy = sy / n;
  let xx = 0, yy = 0, xy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    const a = x - cx, b = y - cy;
    xx += a * a; yy += b * b; xy += a * b;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  let deg = (ang * 180) / Math.PI; if (deg < 0) deg += 180;
  const ecc = Math.hypot(xx - yy, 2 * xy) / (xx + yy || 1);
  return {
    cp, cov: n / (cv.width * cv.height), deg, ecc,
    cxN: cx / cv.width, cyN: (cy - S * 0.5) / S, // renormalize cy into the [0,1] cell band the glyph actually occupies (baseline offset S*1.5 on a 2S-tall canvas, glyph band ~[S*0.5, S*1.5])
    bboxXN: [minX / cv.width, maxX / cv.width],
    bboxYN: [(minY - S * 0.5) / S, (maxY - S * 0.5) / S],
  };
}

// Candidates for the HORIZONTAL (row-position) bucket: already-shipped
// overline/hyphen/underscore, plus Block Elements' row-anchored eighths.
const HORIZ = {
  "already-shipped": [0x203e /* ‾ */, 0x2d /* - */, 0x5f /* _ */],
  "candidates": [0x2594 /* ▔ upper 1/8 */, 0x2581 /* ▁ lower 1/8 */, 0x2582 /* ▂ lower 1/4 */, 0x2583 /* ▃ lower 3/8 */],
};
// Candidates for the VERTICAL (column-position) bucket: already-shipped
// left-1/8 / vbar / right-1/8, plus Block Elements' column-anchored eighths.
const VERT = {
  "already-shipped": [0x258f /* ▏ left 1/8 */, 0x7c /* | */, 0x2595 /* ▕ right 1/8 */],
  "candidates": [0x258e /* ▎ left 1/4 */, 0x258d /* ▍ left 3/8 */, 0x258c /* ▌ left 1/2 */, 0x2590 /* ▐ right 1/2 */],
};

console.log(`font: ${FONT}  (registered families: ${GlobalFonts.families.length})\n`);

function report(title, groups) {
  console.log(`== ${title}`);
  const rows = [];
  for (const [label, cps] of Object.entries(groups)) {
    for (const cp of cps) {
      const m = measure(cp);
      if (!m) { console.log(`  U+${cp.toString(16)} — NOT RENDERED (absent from font)`); continue; }
      rows.push({ ...m, label });
    }
  }
  return rows;
}

const horizRows = report("Horizontal (row-position) candidates — sorted by centroid row", HORIZ);
horizRows.sort((a, b) => a.cyN - b.cyN);
for (const r of horizRows) {
  console.log(`  [${r.label.padEnd(16)}] U+${r.cp.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(r.cp)}  ` +
    `row-centroid ${r.cyN.toFixed(3)}  cov ${(r.cov * 100).toFixed(1).padStart(5)}%  ecc ${r.ecc.toFixed(2)}  ` +
    `bboxY[${r.bboxYN[0].toFixed(2)},${r.bboxYN[1].toFixed(2)}]`);
}

console.log();
const vertRows = report("Vertical (column-position) candidates — sorted by centroid col", VERT);
vertRows.sort((a, b) => a.cxN - b.cxN);
for (const r of vertRows) {
  console.log(`  [${r.label.padEnd(16)}] U+${r.cp.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(r.cp)}  ` +
    `col-centroid ${r.cxN.toFixed(3)}  cov ${(r.cov * 100).toFixed(1).padStart(5)}%  ecc ${r.ecc.toFixed(2)}  ` +
    `bboxX[${r.bboxXN[0].toFixed(2)},${r.bboxXN[1].toFixed(2)}]`);
}
