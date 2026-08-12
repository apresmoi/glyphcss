import { readFileSync } from "node:fs";
import { parseFont } from "../../../packages/fonts/dist/index.js";

const fontBuf = readFileSync("/tmp/roboto700.ttf");
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

// Re-derive groupShapes' depth/parity check WITHOUT importing internal
// (not exported) — copy just the nesting-depth logic to detect fallback.
function signedArea(c) {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const hit = (yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function checkFallback(contours) {
  const valid = contours.filter((c) => c.length >= 3);
  const n = valid.length;
  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const probe = valid[i][0];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (pointInPolygon(probe, valid[j])) depth[i]++;
    }
  }
  const fallback = n > 0 && depth.every((d) => d % 2 === 1);
  return { n, depth, fallback, areas: valid.map((v) => signedArea(v)) };
}

for (const ch of ["h", "p", "y", "G", "l", "C", "S"]) {
  const g = font.glyph(ch.codePointAt(0), 4);
  const r = checkFallback(g.contours);
  console.log(ch, "contours:", r.n, "depths:", r.depth, "fallback:", r.fallback, "areas:", r.areas.map(a=>a.toFixed(0)));
}
