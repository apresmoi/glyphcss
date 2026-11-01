// Step 2 — the rubric. Lower is better for every term. All lengths are in
// CELL-WIDTH units (cw = the face's advance), measured on the composited
// coverage image R (device px, 0..1) against the true curve P.
//
// Terms (each reported separately; `total` is the weighted sum):
//   chamfer  symmetric mean chamfer distance: ½·(mean over ink of d(ink→P),
//            coverage-weighted) + ½·(mean over P samples of d(P→nearest ink)).
//   p95      max of the two directions' 95th percentiles.
//   gap      fraction of P's arc length with no ink within r = 0.25 cw.
//   maxGap   longest such uncovered run, in cw.
//   stray    fraction of ink mass farther than 0.5 cw from P.
//   angle    ink orientation vs P's tangent, mean |Δ| in degrees over covered
//            samples. Orientation = principal axis of the ink's second-moment
//            (inertia) tensor inside a 1 cw box centred on the sample; a
//            sample's error is coherence·|Δθ| + (1 − coherence)·45°, so
//            isotropic ink (a dot, a blob) scores like a random orientation.
//            (A gradient structure tensor was tried first and rejected: it
//            reads every row of braille dots as isotropic blobs, 40–45° at
//            any angle, even after σ = 0.15 cw pre-smoothing.)
//   cv       weight evenness: coefficient of variation of ink mass per unit
//            arc length, binned every 1 cw along P (ink assigned to its
//            nearest P sample within 0.75 cw).
// Distances are capped at 3 cw. "Ink" for P→ink distance and coverage is
// R ≥ 0.3; ink→P and stray use all ink weighted by R.

export const RUBRIC = {
  sampleStep: 0.05, // cw between P samples
  inkThreshold: 0.3,
  coverRadius: 0.25,
  strayRadius: 0.5,
  angleHalfWindow: 0.5,
  binLength: 1,
  assignRadius: 0.75,
  distCap: 3,
};

/** Weights of the total. Change here; every reported total uses these. */
export const WEIGHTS = {
  chamfer: 1.0, // per cw
  p95: 0.25, // per cw
  gap: 2.0, // per unit fraction
  maxGap: 0.25, // per cw
  stray: 1.0, // per unit fraction
  angle: 1 / 45, // per degree (45° ≙ 1.0)
  cv: 0.5,
};

export const TERMS = Object.keys(WEIGHTS);

export function totalOf(t, weights = WEIGHTS) {
  let s = 0;
  for (const k of TERMS) s += weights[k] * t[k];
  return s;
}

// ── Euclidean distance transform with nearest-feature index (Felzenszwalb) ──
const INF = 1e20;
function edt1d(f, idxIn, n, d, idxOut, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    idxOut[q] = idxIn[v[k]];
  }
}

/** feature: Int32Array (−1 = none, else feature id). Returns { dist (px), id }. */
export function edt(feature, W, H) {
  const N = Math.max(W, H);
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  const ii = new Int32Array(N), io = new Int32Array(N);
  const tmp = new Float64Array(W * H), tmpId = new Int32Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { const id = feature[y * W + x]; f[y] = id >= 0 ? 0 : INF; ii[y] = id >= 0 ? id : -1; }
    edt1d(f, ii, H, d, io, v, z);
    for (let y = 0; y < H; y++) { tmp[y * W + x] = d[y]; tmpId[y * W + x] = io[y]; }
  }
  const dist = new Float32Array(W * H), id = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) { f[x] = tmp[y * W + x]; ii[x] = tmpId[y * W + x]; }
    edt1d(f, ii, W, d, io, v, z);
    for (let x = 0; x < W; x++) { dist[y * W + x] = Math.sqrt(d[x]); id[y * W + x] = io[x]; }
  }
  return { dist, id };
}

/**
 * Dense samples along the curve. curve = { polylines: [{ pts: [[x,y],..] (px), closed }] }.
 * Each sample: x, y, tx, ty (unit tangent), poly, s (arc px from the polyline start).
 */
export function sampleCurve(curve, cw, step = RUBRIC.sampleStep) {
  const samples = [];
  const polyRanges = [];
  const h = step * cw;
  curve.polylines.forEach((pl, pi) => {
    const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
    let total = 0;
    const segLen = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segLen.push(l); total += l; }
    const n = Math.max(2, Math.round(total / h) + (pl.closed ? 0 : 1));
    const start = samples.length;
    let seg = 0, acc = 0;
    for (let k = 0; k < n; k++) {
      const s = pl.closed ? (k * total) / n : (k * total) / (n - 1);
      while (seg < segLen.length - 1 && acc + segLen[seg] < s) { acc += segLen[seg]; seg++; }
      const t = segLen[seg] > 0 ? Math.min(1, (s - acc) / segLen[seg]) : 0;
      const a = pts[seg], b = pts[seg + 1];
      const L = segLen[seg] || 1;
      samples.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L, poly: pi, s });
    }
    polyRanges.push({ start, end: samples.length, closed: !!pl.closed, length: total });
  });
  return { samples, polyRanges, step: h };
}

/** Rasterise P (dense, ≤ 0.5 px spacing) as features carrying the nearest sample index. */
export function curveFeature(curve, sampled, W, H) {
  const feat = new Int32Array(W * H).fill(-1);
  const { samples, polyRanges } = sampled;
  for (const pr of polyRanges) {
    const n = pr.end - pr.start;
    const last = pr.closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const a = samples[pr.start + k], b = samples[pr.start + ((k + 1) % n)];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const m = Math.max(1, Math.ceil(L / 0.5));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        const x = Math.floor(a.x + (b.x - a.x) * t), y = Math.floor(a.y + (b.y - a.y) * t);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        feat[y * W + x] = pr.start + (t < 0.5 ? k : (k + 1) % n);
      }
    }
  }
  return feat;
}

/** Everything about P on a frame that does not depend on the ink — reusable across renders of one case. */
export function prepareCase(curve, cw, W, H) {
  const sampled = sampleCurve(curve, cw);
  const { dist: dP, id: idP } = edt(curveFeature(curve, sampled, W, H), W, H);
  return { curve, cw, W, H, sampled, dP, idP };
}

function percentile(values, weights, q) {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  let tot = 0;
  for (const i of idx) tot += weights ? weights[i] : 1;
  let acc = 0;
  for (const i of idx) { acc += weights ? weights[i] : 1; if (acc >= q * tot) return values[i]; }
  return values.length ? values[idx[idx.length - 1]] : 0;
}

/** Score a coverage image against a prepared case. Returns every term + total (cw units / fractions / degrees). */
export function score(prep, img) {
  const { cw, W, H, sampled, dP, idP } = prep;
  const { samples, polyRanges } = sampled;
  const cap = RUBRIC.distCap * cw;
  // Ink → P
  let inkMass = 0, inkDist = 0, strayMass = 0;
  const inkD = [], inkW = [];
  const binMass = new Map();
  for (let i = 0; i < img.length; i++) {
    const v = img[i];
    if (v <= 0) continue;
    const d = Math.min(cap, dP[i]);
    inkMass += v; inkDist += v * d;
    if (d > RUBRIC.strayRadius * cw) strayMass += v;
    inkD.push(d); inkW.push(v);
    if (d <= RUBRIC.assignRadius * cw && idP[i] >= 0) {
      const sm = samples[idP[i]];
      const key = sm.poly * 1e6 + Math.floor(sm.s / (RUBRIC.binLength * cw));
      binMass.set(key, (binMass.get(key) ?? 0) + v);
    }
  }
  // P → ink
  const inkFeat = new Int32Array(W * H).fill(-1);
  let anyInk = false;
  for (let i = 0; i < img.length; i++) if (img[i] >= RUBRIC.inkThreshold) { inkFeat[i] = i; anyInk = true; }
  const dInk = anyInk ? edt(inkFeat, W, H).dist : null;
  const sD = new Float64Array(samples.length);
  for (let k = 0; k < samples.length; k++) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(samples[k].x))), y = Math.min(H - 1, Math.max(0, Math.floor(samples[k].y)));
    sD[k] = dInk ? Math.min(cap, dInk[y * W + x]) : cap;
  }
  const covered = new Uint8Array(samples.length);
  let nCovered = 0, sumSD = 0;
  for (let k = 0; k < samples.length; k++) { sumSD += sD[k]; if (sD[k] <= RUBRIC.coverRadius * cw) { covered[k] = 1; nCovered++; } }
  // Gaps (arc-length fraction ≈ sample fraction at uniform spacing) and longest run.
  let maxGap = 0, gapLen = 0, totLen = 0;
  for (const pr of polyRanges) {
    const n = pr.end - pr.start;
    const ds = pr.closed ? pr.length / n : pr.length / Math.max(1, n - 1);
    totLen += pr.length;
    let run = 0, best = 0, first = -1;
    for (let k = 0; k < n; k++) {
      if (!covered[pr.start + k]) { run++; if (run > best) best = run; } else { if (first < 0) first = run; run = 0; }
    }
    if (pr.closed && first >= 0 && run > 0) best = Math.max(best, run + first);
    if (first < 0) best = n;
    let unc = 0; for (let k = 0; k < n; k++) if (!covered[pr.start + k]) unc++;
    gapLen += pr.closed ? unc * ds : (unc / n) * pr.length;
    maxGap = Math.max(maxGap, best * ds);
  }
  // Angle: ink second-moment tensor per sample window, from integral images.
  const W1 = W + 1, N1 = W1 * (H + 1);
  const S0 = new Float64Array(N1), SX = new Float64Array(N1), SY = new Float64Array(N1);
  const SXX = new Float64Array(N1), SXY = new Float64Array(N1), SYY = new Float64Array(N1);
  for (let y = 0; y < H; y++) {
    let r0 = 0, rx = 0, ry = 0, rxx = 0, rxy = 0, ryy = 0;
    const py = y + 0.5;
    for (let x = 0; x < W; x++) {
      const v = img[y * W + x];
      if (v > 0) { const px = x + 0.5; r0 += v; rx += v * px; ry += v * py; rxx += v * px * px; rxy += v * px * py; ryy += v * py * py; }
      const o = (y + 1) * W1 + x + 1, u = o - W1;
      S0[o] = S0[u] + r0; SX[o] = SX[u] + rx; SY[o] = SY[u] + ry;
      SXX[o] = SXX[u] + rxx; SXY[o] = SXY[u] + rxy; SYY[o] = SYY[u] + ryy;
    }
  }
  const box = (S, x0, y0, x1, y1) => S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
  const hw = RUBRIC.angleHalfWindow * cw;
  let angSum = 0, angN = 0;
  for (let k = 0; k < samples.length; k++) {
    if (!covered[k]) continue;
    const sp = samples[k];
    const x0 = Math.max(0, Math.floor(sp.x - hw)), x1 = Math.min(W, Math.ceil(sp.x + hw));
    const y0 = Math.max(0, Math.floor(sp.y - hw)), y1 = Math.min(H, Math.ceil(sp.y + hw));
    const m = box(S0, x0, y0, x1, y1);
    let err = 45;
    if (m > 1e-6) {
      const mx = box(SX, x0, y0, x1, y1) / m, my = box(SY, x0, y0, x1, y1) / m;
      const a = box(SXX, x0, y0, x1, y1) / m - mx * mx;
      const b = box(SXY, x0, y0, x1, y1) / m - mx * my;
      const c = box(SYY, x0, y0, x1, y1) / m - my * my;
      const tr = a + c;
      if (tr > 1e-9) {
        const coh = Math.min(1, Math.sqrt((a - c) * (a - c) + 4 * b * b) / tr);
        const theta = 0.5 * Math.atan2(2 * b, a - c);
        const alpha = Math.atan2(sp.ty, sp.tx);
        let dd = Math.abs(theta - alpha) % Math.PI;
        if (dd > Math.PI / 2) dd = Math.PI - dd;
        err = coh * (dd * 180 / Math.PI) + (1 - coh) * 45;
      }
    }
    angSum += err; angN++;
  }
  // Weight evenness.
  const dens = [];
  for (const [pi, pr] of polyRanges.entries()) {
    const L = pr.length, bl = RUBRIC.binLength * cw;
    const nb = Math.max(1, Math.floor(L / bl));
    for (let b = 0; b < nb; b++) {
      const len = b === nb - 1 ? L - b * bl : bl;
      let m = binMass.get(pi * 1e6 + b) ?? 0;
      if (b === nb - 1) for (let extra = nb; extra * bl < L; extra++) m += binMass.get(pi * 1e6 + extra) ?? 0;
      dens.push(m / len);
    }
  }
  const mean = dens.reduce((s, x) => s + x, 0) / dens.length;
  const sd = Math.sqrt(dens.reduce((s, x) => s + (x - mean) ** 2, 0) / dens.length);
  const cv = mean > 0 ? Math.min(2, sd / mean) : 2;

  const chamferA = inkMass > 0 ? inkDist / inkMass : cap;
  const chamferB = sumSD / samples.length;
  const sDarr = Array.from(sD);
  const t = {
    chamfer: (chamferA + chamferB) / 2 / cw,
    p95: Math.max(inkMass > 0 ? percentile(inkD, inkW, 0.95) : cap, percentile(sDarr, null, 0.95)) / cw,
    gap: gapLen / totLen,
    maxGap: maxGap / cw,
    stray: inkMass > 0 ? strayMass / inkMass : 0,
    angle: angN ? angSum / angN : 45,
    cv,
  };
  t.total = totalOf(t);
  return t;
}
