// Census: which Unicode codepoints actually render THIN LINES in the real font,
// and what angle / offset does each one cover? Throwaway measurement.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
const FONT = process.env.FONT ?? "Menlo";
const S = 64;                       // supersampled cell
const cv = createCanvas(S, Math.round(S * 2));
const ctx = cv.getContext("2d");

const RANGES = [
  ["ASCII lines",      [0x2d, 0x2f, 0x5c, 0x7c, 0x5f, 0x27, 0x60]],
  ["Box Drawing",      range(0x2500, 0x257f)],
  ["Block Elements",   range(0x2580, 0x259f)],
  ["Scan lines",       range(0x23ba, 0x23bd)],
  ["Math diagonals",   [0x27cb, 0x27cd, 0x2215, 0x2216]],
  ["Legacy Computing", range(0x1fb00, 0x1fbaf)],
];
function range(a, b) { const o = []; for (let c = a; c <= b; c++) o.push(c); return o; }

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
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of pts) { const a = x - cx, b = y - cy; xx += a * a; yy += b * b; xy += a * b; }
  // principal axis angle of the inked pixels
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  let deg = (ang * 180) / Math.PI; if (deg < 0) deg += 180;
  const ecc = Math.hypot(xx - yy, 2 * xy) / (xx + yy || 1);   // 1 = perfectly linear
  return { cp, cov: n / (cv.width * cv.height), deg, ecc,
           cxN: cx / cv.width, cyN: cy / cv.height };
}

console.log(`font: ${FONT}  (registered families: ${GlobalFonts.families.length})`);
for (const [label, cps] of RANGES) {
  const rows = [];
  for (const cp of cps) {
    const m = measure(cp);
    // THIN: inked, but only a small fraction of the cell; LINEAR: high eccentricity
    if (m && m.cov > 0.01 && m.cov < 0.20 && m.ecc > 0.55) rows.push(m);
  }
  console.log(`\n== ${label}: ${rows.length} thin-line glyphs`);
  rows.sort((a, b) => a.deg - b.deg);
  for (const r of rows) {
    console.log(`  U+${r.cp.toString(16).toUpperCase().padStart(4,"0")} ${String.fromCodePoint(r.cp)}  ` +
      `angle ${r.deg.toFixed(0).padStart(3)}°  cov ${(r.cov*100).toFixed(1).padStart(4)}%  ` +
      `ecc ${r.ecc.toFixed(2)}  centroid(${r.cxN.toFixed(2)},${r.cyN.toFixed(2)})`);
  }
}
