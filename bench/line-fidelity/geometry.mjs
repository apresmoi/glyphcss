// Step 3 — the test set. Geometry is defined in VISUAL space (device px of the
// face, so 45° looks like 45° on screen and a circle is round), lengths in
// cell widths (cw), then converted to cell coordinates (col, row) where cell
// (c, r) covers [c, c+1) × [r, r+1).
import { mulberry32 } from "./common.mjs";

const MARGIN = 2; // whole cells of blank grid around the geometry

function toCase(id, family, params, polylinesPx, fm) {
  const { cellW: cw, cellH: ch } = fm;
  const all = polylinesPx.flatMap((p) => p.pts);
  const minC = Math.min(...all.map((p) => p[0] / cw)), maxC = Math.max(...all.map((p) => p[0] / cw));
  const minR = Math.min(...all.map((p) => p[1] / ch)), maxR = Math.max(...all.map((p) => p[1] / ch));
  // Shift by whole cells only, so every sub-cell offset is preserved.
  const dc = MARGIN - Math.floor(minC), dr = MARGIN - Math.floor(minR);
  const polylines = polylinesPx.map((p) => ({ closed: p.closed, pts: p.pts.map(([x, y]) => [x / cw + dc, y / ch + dr]) }));
  return { id, family, params, polylines, cols: Math.floor(maxC) + dc + MARGIN + 1, rows: Math.floor(maxR) + dr + MARGIN + 1 };
}

function arcPts(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** All cases for one face's metrics. Anchor points sit at a fixed cell (20, 20) + sub-cell offset. */
export function buildCases(fm, { quick = false } = {}) {
  const { cellW: cw, cellH: ch } = fm;
  const cases = [];
  const anchor = (oc, or) => [(20 + oc) * cw, (20 + or) * ch];
  const angStep = quick ? 10 : 2;
  const offsets = [0, 0.25, 0.5, 0.75];
  for (const len of [6, 20]) {
    for (let deg = 0; deg < 180; deg += angStep) {
      for (const o of offsets) {
        const [mx, my] = anchor(o, o);
        const a = (deg * Math.PI) / 180, hx = (Math.cos(a) * len * cw) / 2, hy = (Math.sin(a) * len * cw) / 2;
        // Screen y points down; deg is measured counter-clockwise on screen.
        cases.push(toCase(`line L${len} ${deg}° o${o}`, "line", { len, deg, offset: o }, [{ closed: false, pts: [[mx - hx, my + hy], [mx + hx, my - hy]] }], fm));
      }
    }
  }
  for (const r of [3, 6, 12]) {
    for (const o of [0, 0.5]) {
      const [cx, cy] = anchor(o, o);
      const n = Math.max(64, Math.round(r * 24));
      const pts = arcPts(cx, cy, r * cw, 0, 2 * Math.PI, n).slice(0, -1);
      cases.push(toCase(`circle r${r} o${o}`, "circle", { r, offset: o }, [{ closed: true, pts }], fm));
    }
    const [cx, cy] = anchor(0.25, 0.25);
    cases.push(toCase(`arc r${r} 30°-150°`, "arc", { r }, [{ closed: false, pts: arcPts(cx, cy, r * cw, Math.PI / 6, (5 * Math.PI) / 6, Math.max(32, r * 12)) }], fm));
  }
  for (const turn of [30, 60, 90, 135]) {
    for (const lead of [0, 20, 45, 70]) {
      const [mx, my] = anchor(0.3, 0.6);
      const a0 = (lead * Math.PI) / 180, a1 = ((lead + turn) * Math.PI) / 180, L = 8 * cw;
      const p0 = [mx - Math.cos(a0) * L, my + Math.sin(a0) * L], p2 = [mx + Math.cos(a1) * L, my - Math.sin(a1) * L];
      cases.push(toCase(`corner ${turn}° lead ${lead}°`, "corner", { turn, lead }, [{ closed: false, pts: [p0, [mx, my], p2] }], fm));
    }
  }
  // Map-like wiggles: a smoothed random walk, ~1 vertex per 1.5 cw (vector-tile-ish density).
  for (let k = 0; k < (quick ? 1 : 4); k++) {
    const rnd = mulberry32(1000 + k);
    let [x, y] = anchor(rnd(), rnd());
    let heading = rnd() * Math.PI * 2, turnRate = 0;
    const pts = [[x, y]];
    for (let i = 0; i < 24; i++) {
      turnRate = 0.7 * turnRate + 0.5 * (rnd() - 0.5);
      heading += turnRate;
      const step = (1 + rnd()) * cw;
      x += Math.cos(heading) * step; y += Math.sin(heading) * step;
      pts.push([x, y]);
    }
    cases.push(toCase(`wiggle ${k}`, "wiggle", { seed: 1000 + k }, [{ closed: false, pts }], fm));
  }
  return cases;
}

/** Curve in device px of the scoring frame (origin at the frame's cell (0,0)). */
export function caseCurvePx(c, fm, originX, originY) {
  return { polylines: c.polylines.map((p) => ({ closed: p.closed, pts: p.pts.map(([col, row]) => [originX + col * fm.cellW, originY + row * fm.cellH]) })) };
}

export function caseFrame(c, fm) {
  const originX = fm.padX, originY = fm.padY;
  return { originX, originY, W: Math.ceil(c.cols * fm.cellW) + 2 * fm.padX, H: Math.ceil(c.rows * fm.cellH) + 2 * fm.padY };
}
