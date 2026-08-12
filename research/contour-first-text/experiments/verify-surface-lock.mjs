// Playwright verification: does the matrix-rain flow direction stay LOCKED
// to the word's own silhouette axis as the mesh turns (texture-locked, the
// fix), or does it drift relative to the word as the mesh turns (the
// world-anchored bug)?
//
// Uses a single wide line ("HELLO", tilt=0, no camera perspective distortion
// beyond the plain default) so the word's own on-screen long axis (from PCA
// of the rendered pixel cloud) is unambiguous — a two-line near-square block
// makes that axis nearly degenerate (eigenvalues too close together), which
// is why an earlier pass at this test on the two-line "Glyph\nCSS" repro
// gave a noisy silhouette axis. Per turn we recover two angles from the SAME
// screen-space point cloud (every rendered rain-colored cell center):
//   1. `silhouetteAngle` — PCA dominant axis of the raw (x, y) positions.
//      The front cap is one rigid flat plane, so this axis necessarily
//      co-rotates exactly with the mesh — it's derived purely from where
//      the geometry projects, nothing to do with the effect.
//   2. `flowAngle` — linear-regression gradient of green-channel intensity
//      over (x, y). `scalePackedColor` scales R/G/B by a factor of the same
//      base color per `behind` (distance behind a strand's head), so hue is
//      constant and intensity encodes "distance along the flow axis" — the
//      gradient direction IS the flow axis.
// If the flow is painted ON the face and turns WITH it, the angular offset
// between (1) and (2) should stay ~constant across turn values (both
// co-rotate together). If the flow is anchored to world/screen space
// instead, that offset drifts as the mesh turns.
import { chromium } from "playwright";

const BASE =
  "http://localhost:4323/wordart?text=HELLO&profile=flat&depth=10&color=%231d6b3a&side=%230f3a20&back=%230f3a20&tilt=0&density=2.6&hl=hide&fx=matrix-rain&fxs=1.8&fxx=%7B%22glyphs%22%3A%22GLYPH01%22%2C%22direction%22%3A%22right%22%2C%22scale%22%3A2.56%2C%22speedMin%22%3A40%2C%22speedMax%22%3A40%2C%22trail%22%3A59%2C%22density%22%3A1%2C%22seed%22%3A6428%2C%22colorMode%22%3A%22monochrome%22%2C%22color%22%3A%22%231aa34a%22%2C%22headColor%22%3A%22%23baffd6%22%7D";

async function samplePoints(page, turnDeg) {
  const url = `${BASE}&spin=0&turn=${turnDeg}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("pre");
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const pre = document.querySelector("pre");
    const spans = pre.querySelectorAll("span");
    const out = [];
    for (const el of spans) {
      const style = getComputedStyle(el);
      const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style.color);
      if (!m) continue;
      const g = Number(m[2]);
      if (g === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      out.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, g });
    }
    return out;
  });
}

function fitGradient(points) {
  const n = points.length;
  let sx = 0, sy = 0, sg = 0, sxx = 0, syy = 0, sxy = 0, sxg = 0, syg = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sg += p.g;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxg += p.x * p.g; syg += p.y * p.g;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const B = [sxg, syg, sg];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(A);
  const withCol = (col) => A.map((row, i) => row.map((v, j) => (j === col ? B[i] : v)));
  const a = det3(withCol(0)) / D;
  const b = det3(withCol(1)) / D;
  return (Math.atan2(b, a) * 180) / Math.PI;
}

function silhouetteAxis(points) {
  const n = points.length;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  cxx /= n; cyy /= n; cxy /= n;
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const eigGap = Math.hypot(cxx - cyy, 2 * cxy); // 0 = degenerate (circular) axis
  return { angle: (theta * 180) / Math.PI, eigGap, spread: cxx + cyy };
}

function lineAngle180(deg) {
  let d = deg % 180;
  if (d < 0) d += 180;
  return d;
}

function angleDiff180(a, b) {
  let d = lineAngle180(a) - lineAngle180(b);
  d = ((d + 90) % 180 + 180) % 180 - 90;
  return d;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  const turns = [0, 20, 40, 60, 80];
  const rows = [];
  for (const turn of turns) {
    const pts = await samplePoints(page, turn);
    const flow = fitGradient(pts);
    const sil = silhouetteAxis(pts);
    const offset = angleDiff180(flow, sil.angle);
    rows.push({ turn, n: pts.length, flow: lineAngle180(flow), silhouette: lineAngle180(sil.angle), eigGap: sil.eigGap, spread: sil.spread, offset });
  }

  console.log("turn | n pts | flow-axis | silhouette-axis | eigGap/spread (axis confidence) | offset(flow - silhouette)");
  for (const r of rows) {
    const confidence = (r.eigGap / r.spread).toFixed(3);
    console.log(`${String(r.turn).padStart(4)} | ${String(r.n).padStart(5)} | ${r.flow.toFixed(2).padStart(9)} | ${r.silhouette.toFixed(2).padStart(16)} | ${confidence.padStart(6)} | ${r.offset.toFixed(2).padStart(6)}`);
  }
  const offsets = rows.map((r) => r.offset);
  const mean = offsets.reduce((s, v) => s + v, 0) / offsets.length;
  const variance = offsets.reduce((s, v) => s + (v - mean) ** 2, 0) / offsets.length;
  console.log(`\noffset mean=${mean.toFixed(2)}deg, stddev=${Math.sqrt(variance).toFixed(2)}deg (lower stddev = flow tracks the word's own axis more consistently across rotation)`);

  await browser.close();
})();
