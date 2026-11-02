// Phase 2 — animation: frame sequences and temporal metrics.
//
// Every frame of a sequence shares ONE grid (same cols/rows and the same
// whole-cell shift), so cell (c, r) means the same screen cell across frames.
// Strategies render each frame independently, as the renderer does.
import { mulberry32 } from "./common.mjs";

export const FRAMES = 60;
const MARGIN = 2;

function arcPts(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Sequences for one face: [{ id, kind, frames: [case...] }]. */
export function buildSequences(fm) {
  const { cellW: cw, cellH: ch } = fm;
  const at = (oc, or) => [(20 + oc) * cw, (20 + or) * ch];
  const seg = (cx, cy, deg, len) => {
    const a = (deg * Math.PI) / 180, hx = (Math.cos(a) * len * cw) / 2, hy = (Math.sin(a) * len * cw) / 2;
    return [{ closed: false, pts: [[cx - hx, cy + hy], [cx + hx, cy - hy]] }];
  };
  const defs = [];
  // Drift: 12 cw segment translating diagonally across cells (cells/frame on both axes).
  for (const [speed, tag] of [[0.05, "slow"], [0.3, "fast"]]) {
    for (const deg of [20, 65]) {
      defs.push({ id: `drift-${tag} ${deg}°`, kind: `drift-${tag}`, gen: (t) => { const [x, y] = at(0.1 + speed * t, 0.2 + speed * 0.6 * t); return seg(x, y, deg, 12); } });
    }
  }
  for (const [w, tag] of [[0.5, "slow"], [3, "fast"]]) {
    defs.push({ id: `rotate-${tag} ${w}°/f`, kind: `rotate-${tag}`, gen: (t) => { const [x, y] = at(0.3, 0.4); return seg(x, y, 10 + w * t, 12); } });
  }
  defs.push({ id: "circle r4→8", kind: "scale", gen: (t) => { const r = 4 + (4 * t) / (FRAMES - 1); const [x, y] = at(0.25, 0.25); return [{ closed: true, pts: arcPts(x, y, r * cw, Math.max(64, Math.round(r * 24))) }]; } });
  {
    const rnd = mulberry32(1000);
    let [x, y] = [0, 0], heading = rnd() * Math.PI * 2, turn = 0;
    const base = [[x, y]];
    for (let i = 0; i < 16; i++) { turn = 0.7 * turn + 0.5 * (rnd() - 0.5); heading += turn; const step = (1 + rnd()) * cw; x += Math.cos(heading) * step; y += Math.sin(heading) * step; base.push([x, y]); }
    defs.push({ id: "wiggle drift 0.1", kind: "wiggle", gen: (t) => { const [ox, oy] = at(0.1 * t, 0.04 * t); return [{ closed: false, pts: base.map(([px, py]) => [px + ox, py + oy]) }]; } });
  }
  return defs.map((d) => {
    const px = Array.from({ length: FRAMES }, (_, t) => d.gen(t));
    const all = px.flatMap((pls) => pls.flatMap((p) => p.pts));
    const minC = Math.min(...all.map((p) => p[0] / cw)), maxC = Math.max(...all.map((p) => p[0] / cw));
    const minR = Math.min(...all.map((p) => p[1] / ch)), maxR = Math.max(...all.map((p) => p[1] / ch));
    const dc = MARGIN - Math.floor(minC), dr = MARGIN - Math.floor(minR);
    const cols = Math.floor(maxC) + dc + MARGIN + 1, rows = Math.floor(maxR) + dr + MARGIN + 1;
    const frames = px.map((pls, t) => ({
      id: `${d.id} #${t}`, family: d.kind, params: { t }, cols, rows,
      polylines: pls.map((p) => ({ closed: p.closed, pts: p.pts.map(([x, y]) => [x / cw + dc, y / ch + dr]) })),
    }));
    return { id: d.id, kind: d.kind, cols, rows, frames };
  });
}

// ── Temporal metrics ─────────────────────────────────────────────────────

const key = (c, r) => r * 1e5 + c;
const toMap = (cells) => { const m = new Map(); for (const [c, r, g] of cells) m.set(key(c, r), g); return m; };

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function polyDist(p, pls) {
  let d = Infinity;
  for (const pl of pls) {
    const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
    for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p[0], p[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return d;
}
/** Dense points (cell coords) of a frame's curve, every ~0.05 cell. */
function densePts(pls) {
  const out = [];
  for (const pl of pls) {
    const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
  }
  return out;
}

/**
 * How far the true geometry moved IN cell (c, r) between two frames, in
 * cells: the farthest any curve point inside the cell (grown by ½ cell)
 * lies from the other frame's curve, both directions. Sliding along itself
 * reads as no motion (correct — the line there looks the same); no curve
 * near the cell in either frame reads as 0.
 */
function localMotion(c, r, denseA, plsA, denseB, plsB) {
  const inside = (p) => p[0] >= c - 0.5 && p[0] < c + 1.5 && p[1] >= r - 0.5 && p[1] < r + 1.5;
  let m = 0;
  for (const p of denseB) if (inside(p)) m = Math.max(m, polyDist(p, plsA));
  for (const p of denseA) if (inside(p)) m = Math.max(m, polyDist(p, plsB));
  return m;
}

/**
 * Unjustified flip: a cell changes glyph although the true geometry in it has
 * moved < 0.1 cell since that cell's previous change (see localMotion).
 * frames: [{ cells: [[c,r,g]], inkCentroid: [x,y] (cw), trueCentroid: [x,y] (cw), polylines (cell coords) }].
 * Returns change rate, unjustified flips, centroid jitter, flicker.
 */
export function temporalMetrics(frames) {
  const maps = frames.map((f) => toMap(f.cells));
  const dense = frames.map((f) => densePts(f.polylines));
  let rateSum = 0, changesTotal = 0, unjust = 0, jitter2 = 0, trueSpeed2 = 0;
  // A change is judged against the geometry's motion since the cell last
  // changed (frame 0 at first): a slow drift that moves 0.05 cell/frame
  // legitimately re-glyphs a cell every few frames, but not every frame.
  const lastChange = new Map();
  for (let t = 1; t < frames.length; t++) {
    const a = maps[t - 1], b = maps[t];
    const keys = new Set([...a.keys(), ...b.keys()]);
    let changed = 0;
    for (const k of keys) {
      if ((a.get(k) ?? " ") === (b.get(k) ?? " ")) continue;
      changed++;
      const c = k % 1e5, r = Math.floor(k / 1e5);
      const t0 = lastChange.get(k) ?? 0;
      if (localMotion(c, r, dense[t0], frames[t0].polylines, dense[t], frames[t].polylines) < 0.1) unjust++;
      lastChange.set(k, t);
    }
    changesTotal += changed;
    rateSum += changed / Math.max(1, b.size);
    const vi = [frames[t].inkCentroid[0] - frames[t - 1].inkCentroid[0], frames[t].inkCentroid[1] - frames[t - 1].inkCentroid[1]];
    const vt = [frames[t].trueCentroid[0] - frames[t - 1].trueCentroid[0], frames[t].trueCentroid[1] - frames[t - 1].trueCentroid[1]];
    jitter2 += (vi[0] - vt[0]) ** 2 + (vi[1] - vt[1]) ** 2;
    trueSpeed2 += vt[0] ** 2 + vt[1] ** 2;
  }
  // Flicker: A at t, back to A at t+2 or t+3, something else in between.
  let flicker = 0;
  const allKeys = new Set(maps.flatMap((m) => [...m.keys()]));
  for (const k of allKeys) {
    const seq = maps.map((m) => m.get(k) ?? " ");
    for (let t = 0; t + 2 < seq.length; t++) {
      if (seq[t + 1] === seq[t]) continue;
      if (seq[t + 2] === seq[t] || (t + 3 < seq.length && seq[t + 3] === seq[t] && seq[t + 2] !== seq[t])) flicker++;
    }
  }
  const T = frames.length - 1;
  return {
    changeRate: rateSum / T, // changed cells per frame per stroke cell
    changesPerFrame: changesTotal / T,
    unjustifiedPerFrame: unjust / T,
    unjustifiedShare: changesTotal ? unjust / changesTotal : 0,
    jitter: Math.sqrt(jitter2 / T), // cw per frame, RMS
    trueSpeed: Math.sqrt(trueSpeed2 / T),
    flickerPerFrame: flicker / T,
  };
}

/** Ink centroid of a composite (cw units) and arc-length centroid of the true curve (cw units). */
export function centroids(img, W, frame, curvePx, cw) {
  let s = 0, sx = 0, sy = 0;
  for (let i = 0; i < img.length; i++) { const v = img[i]; if (v > 0) { s += v; sx += v * ((i % W) + 0.5); sy += v * (Math.floor(i / W) + 0.5); } }
  let L = 0, lx = 0, ly = 0;
  for (const pl of curvePx.polylines) {
    const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      L += l; lx += l * (pts[i][0] + pts[i - 1][0]) / 2; ly += l * (pts[i][1] + pts[i - 1][1]) / 2;
    }
  }
  return { ink: s > 0 ? [sx / s / cw, sy / s / cw] : [NaN, NaN], truth: [lx / L / cw, ly / L / cw] };
}
