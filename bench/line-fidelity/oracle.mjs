// Step 4 — the headroom: a chain DP (Viterbi) over glyph assignments, and a
// "best single glyph per (angle bucket, offset)" lookup table.
//
// Chain: the cells the true curve passes through, in arc order (one node per
// visited cell). A node's label is (δ, glyph): δ ∈ {−1, 0, +1} moves its ink
// one cell along the node's minor axis (rows for an x-major tangent in cell
// space, columns otherwise) — the 1-cell band — or the label is blank.
//
// DP objective = the rubric decomposed onto that chain:
//   EXACT (up to the 2-node window below): P→ink chamfer half and the break
//     fraction are means over P samples; each sample is charged to the pair
//     of consecutive nodes nearest it (its own node + the neighbour on its
//     side), with distance = min over the two labels' ink and "covered" =
//     either label's tube ink projects within ±0.25 cw of it (the rubric's
//     own break test).
//     Ink from any other node is ignored there (gaps over-estimated).
//   APPROXIMATE: ink→P chamfer half and stray are means over INK; the DP
//     uses Σ/M_ref with M_ref re-estimated from the previous solution
//     (3 Dinkelbach-style rounds, keep the best full-rubric result).
//     Angle: each glyph's own whole-mask inertia orientation vs the node
//     tangent, charged per owned sample. Weight evenness: unary penalty on
//     the node's ink mass vs (current mean density × its arc span).
//   OMITTED: p95 and maxGap (order statistics; no additive form).
// Overlapping overflow between cells is not modelled (masks are summed then
// clamped only at re-score). The REPORTED number is always the full rubric
// re-scored on the composited DP output.
import { cellPlacement } from "./composite.mjs";
import { edt, RUBRIC, WEIGHTS } from "./rubric.mjs";

const TAU = RUBRIC.inkThreshold;

/** Per-glyph, per-phase sparse ink + binary-ink EDT + inertia orientation. */
export function prepareGlyphs(fm, glyphs) {
  const out = new Map();
  for (const g of glyphs) {
    if (g === " ") continue;
    const m = fm.masks.get(g);
    const phases = m.phases.map((a) => {
      const idx = [], val = [];
      let mass = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
      const feat = new Int32Array(m.W * m.H).fill(-1);
      let any = false;
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (v <= 0) continue;
        idx.push(i); val.push(v);
        const x = (i % m.W) + 0.5, y = Math.floor(i / m.W) + 0.5;
        mass += v; sx += v * x; sy += v * y; sxx += v * x * x; sxy += v * x * y; syy += v * y * y;
        if (v >= TAU) { feat[i] = i; any = true; }
      }
      const dist = any ? edt(feat, m.W, m.H).dist : null;
      let theta = 0, coh = 0;
      if (mass > 0) {
        const mx = sx / mass, my = sy / mass;
        const A = sxx / mass - mx * mx, B = sxy / mass - mx * my, C = syy / mass - my * my;
        theta = 0.5 * Math.atan2(2 * B, A - C);
        coh = A + C > 1e-9 ? Math.min(1, Math.sqrt((A - C) ** 2 + 4 * B * B) / (A + C)) : 0;
      }
      return { idx: Int32Array.from(idx), val: Float32Array.from(val), mass, dist, theta, coh };
    });
    out.set(g, { W: m.W, H: m.H, phases });
  }
  return out;
}

function angleErrDeg(theta, coh, tx, ty) {
  let dd = Math.abs(theta - Math.atan2(ty, tx)) % Math.PI;
  if (dd > Math.PI / 2) dd = Math.PI - dd;
  return coh * (dd * 180) / Math.PI + (1 - coh) * 45;
}

/** Chain nodes for a prepared case. */
export function buildChain(c, fm, frame, prep) {
  const { samples, polyRanges } = prep.sampled;
  const cellOf = (s) => [Math.floor((s.x - frame.originX) / fm.cellW), Math.floor((s.y - frame.originY) / fm.cellH)];
  const nodes = [];
  for (const pr of polyRanges) {
    const n = pr.end - pr.start;
    let order = [...Array(n).keys()].map((k) => pr.start + k);
    if (pr.closed) {
      // Start the walk on a cell boundary so the wrap does not split one cell into two nodes.
      const c0 = cellOf(samples[order[0]]);
      const k = order.findIndex((i) => { const ci = cellOf(samples[i]); return ci[0] !== c0[0] || ci[1] !== c0[1]; });
      if (k > 0) order = [...order.slice(k), ...order.slice(0, k)];
    }
    let cur = null;
    for (const si of order) {
      const [col, row] = cellOf(samples[si]);
      if (!cur || cur.col !== col || cur.row !== row) { cur = { col, row, samples: [] }; nodes.push(cur); }
      cur.samples.push(si);
    }
    if (nodes.length) nodes[nodes.length - 1].polyEnd = true;
  }
  for (const nd of nodes) {
    let tx = 0, ty = 0;
    for (const si of nd.samples) { tx += samples[si].tx; ty += samples[si].ty; }
    const L = Math.hypot(tx, ty) || 1;
    nd.tx = tx / L; nd.ty = ty / L;
    // Major axis in CELL space decides the band direction.
    const xMajor = Math.abs(nd.tx / fm.cellW) >= Math.abs(nd.ty / fm.cellH);
    nd.axis = xMajor ? [0, 1] : [1, 0];
    nd.span = nd.samples.length * prep.sampled.step;
    const h = Math.ceil(nd.samples.length / 2);
    nd.first = nd.samples.slice(0, h);
    nd.second = nd.samples.slice(h);
  }
  // Pair windows: node i's second half + node i+1's first half, unless i ends a polyline.
  for (let i = 0; i < nodes.length; i++) nodes[i].linkNext = i + 1 < nodes.length && !nodes[i].polyEnd;
  return nodes;
}

/** Everything the DP and the table need about one case. */
export function caseContext(c, fm, frame, prep) {
  const nodes = buildChain(c, fm, frame, prep);
  return { c, fm, frame, prep, nodes, N: prep.sampled.samples.length, L: prep.sampled.polyRanges.reduce((s, p) => s + p.length, 0) };
}

const BLANK = { g: " ", dc: 0, dr: 0 };

/**
 * Cost components of one (node i, label): ink terms, and the label's ink
 * distance at the samples of its two pair windows (own halves + the
 * neighbours' adjoining halves).
 */
function labelCost(ctx, gp, i, lab) {
  const nd = ctx.nodes[i];
  const prevSecond = i > 0 && ctx.nodes[i - 1].linkNext ? ctx.nodes[i - 1].second : [];
  const nextFirst = nd.linkNext ? ctx.nodes[i + 1].first : [];
  const { fm, frame, prep } = ctx;
  const { samples } = prep.sampled;
  const cw = fm.cellW;
  const cap = RUBRIC.distCap * cw;
  const pc = nd.col + lab.dc, pr = nd.row + lab.dr;
  const res = { lab, pc, pr, mass: 0, sumVD: 0, sumVS: 0, angle: 0, dFirst: null, dSecond: null, dPrev: null, dNext: null, cFirst: null, cSecond: null, cPrev: null, cNext: null };
  if (lab.g === " ") {
    res.dFirst = new Float32Array(nd.first.length).fill(cap);
    res.dSecond = new Float32Array(nd.second.length).fill(cap);
    res.dPrev = new Float32Array(prevSecond.length).fill(cap);
    res.dNext = new Float32Array(nextFirst.length).fill(cap);
    res.cFirst = new Uint8Array(nd.first.length);
    res.cSecond = new Uint8Array(nd.second.length);
    res.cPrev = new Uint8Array(prevSecond.length);
    res.cNext = new Uint8Array(nextFirst.length);
    return res;
  }
  const { polyRanges } = prep.sampled;
  if (marks.length < samples.length) marks = new Uint8Array(samples.length);
  const touched = [];
  const kArc = Math.round(RUBRIC.coverRadius / RUBRIC.sampleStep);
  const tube = RUBRIC.tubeRadius * cw;
  const G = gp.get(lab.g);
  const [x0, y0, phase] = cellPlacement(fm, pc, pr, frame.originX, frame.originY);
  const P = G.phases[phase];
  const { W, H } = frame;
  for (let k = 0; k < P.idx.length; k++) {
    const i = P.idx[k], v = P.val[k];
    const fx = x0 + (i % G.W), fy = y0 + Math.floor(i / G.W);
    const d = fx >= 0 && fy >= 0 && fx < W && fy < H ? Math.min(cap, prep.dP[fy * W + fx]) : cap;
    res.sumVD += v * d;
    if (d > RUBRIC.strayRadius * cw) res.sumVS += v;
    if (v >= TAU && d <= tube) {
      const si = prep.idP[fy * W + fx];
      if (si < 0) continue;
      const rg = polyRanges[samples[si].poly], n = rg.end - rg.start;
      for (let j = -kArc; j <= kArc; j++) {
        let t = si - rg.start + j;
        if (rg.closed) t = ((t % n) + n) % n; else if (t < 0 || t >= n) continue;
        if (!marks[rg.start + t]) { marks[rg.start + t] = 1; touched.push(rg.start + t); }
      }
    }
  }
  res.mass = P.mass;
  res.angle = P.mass > 0 ? angleErrDeg(P.theta, P.coh, nd.tx, nd.ty) : 45;
  const look = (si) => {
    if (!P.dist) return cap;
    const s = samples[si];
    const ix = Math.floor(s.x) - x0, iy = Math.floor(s.y) - y0;
    if (ix < 0 || iy < 0 || ix >= G.W || iy >= G.H) return cap;
    return Math.min(cap, P.dist[iy * G.W + ix]);
  };
  res.dFirst = Float32Array.from(nd.first, look);
  res.dSecond = Float32Array.from(nd.second, look);
  res.dPrev = Float32Array.from(prevSecond, look);
  res.dNext = Float32Array.from(nextFirst, look);
  res.cFirst = Uint8Array.from(nd.first, (si) => marks[si]);
  res.cSecond = Uint8Array.from(nd.second, (si) => marks[si]);
  res.cPrev = Uint8Array.from(prevSecond, (si) => marks[si]);
  res.cNext = Uint8Array.from(nextFirst, (si) => marks[si]);
  for (const t of touched) marks[t] = 0;
  return res;
}

let marks = new Uint8Array(0);

/** Pair cost of window (i−1, i): node i−1's second half + node i's first half, each sample covered by the nearer label. */
function pairCost(f, la, lb) {
  let c = 0;
  for (let k = 0; k < la.dSecond.length; k++) c += f(Math.min(la.dSecond[k], lb.dPrev[k]), la.cSecond[k] | lb.cPrev[k]);
  for (let k = 0; k < lb.dFirst.length; k++) c += f(Math.min(lb.dFirst[k], la.dNext[k]), lb.cFirst[k] | la.cNext[k]);
  return c;
}

/** Per-sample coverage cost (P→ink chamfer half + break), as a share of the rubric total. */
function coverCostFn(ctx) {
  const cw = ctx.fm.cellW, N = ctx.N;
  const a = WEIGHTS.chamfer / 2 / cw / N, b = WEIGHTS.gap / N;
  return (d, covered) => a * d + (covered ? 0 : b);
}

function unaryOf(ctx, nd, lc, mref, rho, nNodes) {
  const cw = ctx.fm.cellW;
  let u = 0;
  if (lc.lab.g !== " ") {
    u += (WEIGHTS.chamfer / 2) * (lc.sumVD / cw) / mref + WEIGHTS.stray * lc.sumVS / mref;
    u += WEIGHTS.angle * lc.angle * (nd.samples.length / ctx.N);
  }
  const expect = rho * nd.span;
  u += (WEIGHTS.cv / nNodes) * ((lc.mass - expect) / (rho * cw)) ** 2;
  return u;
}

function labelsFor(ctx, nd, vocab, { shift = true } = {}) {
  const labs = [BLANK];
  const { cols, rows } = ctx.c;
  for (const d of shift ? [-1, 0, 1] : [0]) {
    const dc = nd.axis[0] * d, dr = nd.axis[1] * d;
    const pc = nd.col + dc, pr = nd.row + dr;
    if (pc < 0 || pr < 0 || pc >= cols || pr >= rows) continue;
    for (const g of vocab) labs.push({ g, dc, dr });
  }
  return labs;
}

function assemble(nodes, choice) {
  const cells = new Map();
  let conflicts = 0;
  nodes.forEach((nd, i) => {
    const lc = choice[i];
    if (lc.lab.g === " ") return;
    const key = lc.pr * 1e5 + lc.pc;
    if (cells.has(key)) { conflicts++; return; }
    cells.set(key, { col: lc.pc, row: lc.pr, glyph: lc.lab.g });
  });
  return { cells: [...cells.values()], conflicts };
}

/**
 * Viterbi over pruned label sets. rescore(cells) → full rubric total; the best
 * of the Dinkelbach rounds is returned.
 */
export function dpSolve(ctx, gp, vocab, refMassPerCw, rescore, { M = 48, rounds = 3 } = {}) {
  const { nodes } = ctx;
  const f = coverCostFn(ctx);
  const all = nodes.map((nd, i) => labelsFor(ctx, nd, vocab).map((lab) => labelCost(ctx, gp, i, lab)));
  let rho = refMassPerCw / ctx.fm.cellW;
  let mref = rho * ctx.L;
  let best = null;
  const n = nodes.length;
  for (let round = 0; round < rounds; round++) {
    // Prune each node to its M best labels by SOLO cost (unary + its own samples alone); blank always kept.
    const sets = all.map((lcs, i) => {
      const nd = nodes[i];
      const scored = lcs.map((lc) => {
        let s = unaryOf(ctx, nd, lc, mref, rho, n);
        lc.dFirst.forEach((d, k) => { s += f(d, lc.cFirst[k]); });
        lc.dSecond.forEach((d, k) => { s += f(d, lc.cSecond[k]); });
        return { lc, solo: s, u: 0 };
      });
      const blank = scored[0];
      const rest = scored.slice(1).sort((a, b) => a.solo - b.solo).slice(0, M);
      const keep = [blank, ...rest];
      for (const k of keep) {
        let u = unaryOf(ctx, nd, k.lc, mref, rho, n);
        // Samples with no pair partner (chain ends) are charged to their own node.
        const hasPrev = i > 0 && nodes[i - 1].linkNext;
        if (!hasPrev) k.lc.dFirst.forEach((d, j) => { u += f(d, k.lc.cFirst[j]); });
        if (!nd.linkNext) k.lc.dSecond.forEach((d, j) => { u += f(d, k.lc.cSecond[j]); });
        k.u = u;
      }
      return keep;
    });
    // Forward pass.
    let cost = sets[0].map((k) => k.u);
    const back = [];
    for (let i = 1; i < n; i++) {
      const prev = sets[i - 1], curS = sets[i];
      const linked = nodes[i - 1].linkNext;
      const next = new Float64Array(curS.length).fill(Infinity);
      const arg = new Int32Array(curS.length);
      for (let b = 0; b < curS.length; b++) {
        const lb = curS[b].lc;
        for (let a = 0; a < prev.length; a++) {
          const la = prev[a].lc;
          let c = cost[a];
          if (c >= next[b]) continue;
          if (la.lab.g !== " " && lb.lab.g !== " " && la.pc === lb.pc && la.pr === lb.pr) continue; // one glyph per cell
          if (linked) c += pairCost(f, la, lb);
          if (c < next[b]) { next[b] = c; arg[b] = a; }
        }
        next[b] += curS[b].u;
      }
      back.push(arg);
      cost = next;
    }
    let bi = 0;
    for (let b = 1; b < cost.length; b++) if (cost[b] < cost[bi]) bi = b;
    const choice = new Array(n);
    for (let i = n - 1; i >= 0; i--) { choice[i] = sets[i][bi].lc; if (i > 0) bi = back[i - 1][bi]; }
    const asm = assemble(nodes, choice);
    const total = rescore(asm.cells);
    if (!best || total.total < best.score.total) best = { ...asm, score: total, round, surrogate: cost.reduce((m, x) => Math.min(m, x), Infinity) };
    // Re-estimate the ink normaliser from this solution.
    const mass = choice.reduce((s, lc) => s + lc.mass, 0);
    if (mass <= 0) break;
    mref = mass;
    rho = mass / ctx.L;
  }
  best.K = vocab.length;
  best.labels = 3 * vocab.length + 1;
  best.M = M;
  best.n = n;
  return best;
}

// ── Lookup-table baseline ────────────────────────────────────────────────
export const TABLE_ANGLE_BUCKETS = 16;
export const TABLE_OFFSET_BINS = 8;

/** Table key of a node: (tangent angle bucket in visual space, band axis, offset bin of the cell centre from the line). */
export function tableKey(ctx, nd) {
  const { fm, frame, prep } = ctx;
  let th = (Math.atan2(-nd.ty, nd.tx) * 180) / Math.PI; // screen y down → counter-clockwise degrees
  th = ((th % 180) + 180) % 180;
  const b = Math.floor((th + 180 / TABLE_ANGLE_BUCKETS / 2) / (180 / TABLE_ANGLE_BUCKETS)) % TABLE_ANGLE_BUCKETS;
  const s = prep.sampled.samples[nd.samples[Math.floor(nd.samples.length / 2)]];
  const sc = (s.x - frame.originX) / fm.cellW, sr = (s.y - frame.originY) / fm.cellH;
  const tc = nd.tx / fm.cellW, tr = nd.ty / fm.cellH;
  const xMajor = nd.axis[1] === 1;
  // Line's minor coordinate at the cell centre's major coordinate, minus the centre (cell units).
  const off = xMajor ? sr + (nd.col + 0.5 - sc) * (tr / tc) - (nd.row + 0.5) : sc + (nd.row + 0.5 - sr) * (tc / tr) - (nd.col + 0.5);
  const o = Math.max(0, Math.min(TABLE_OFFSET_BINS - 1, Math.floor((off + 1) / (2 / TABLE_OFFSET_BINS))));
  return (b * 2 + (xMajor ? 0 : 1)) * TABLE_OFFSET_BINS + o;
}

export function tableCells(ctx, table) {
  const cells = new Map();
  for (const nd of ctx.nodes) {
    const g = table.get(tableKey(ctx, nd)) ?? " ";
    if (g === " ") continue;
    cells.set(nd.row * 1e5 + nd.col, { col: nd.col, row: nd.row, glyph: g });
  }
  return [...cells.values()];
}

/**
 * Fit the table by coordinate descent on the DP surrogate (δ = 0 labels):
 * each entry takes the glyph that minimises Σ unary + pair coverage over
 * every training node with that key, holding the other entries fixed.
 */
export function fitTable(ctxs, gp, vocab, refMassPerCw, { passes = 3 } = {}) {
  const items = ctxs.map((ctx) => {
    const rho = refMassPerCw / ctx.fm.cellW, mref = rho * ctx.L;
    const cache = ctx.nodes.map(() => new Map());
    const lcOf = (i, g) => {
      let lc = cache[i].get(g);
      if (!lc) {
        lc = labelCost(ctx, gp, i, g === " " ? BLANK : { g, dc: 0, dr: 0 });
        lc.u = unaryOf(ctx, ctx.nodes[i], lc, mref, rho, ctx.nodes.length);
        const nd = ctx.nodes[i], f = coverCostFn(ctx);
        // Chain-end halves have no pair partner: charge them here, as the DP does.
        if (!(i > 0 && ctx.nodes[i - 1].linkNext)) lc.dFirst.forEach((d, k) => { lc.u += f(d, lc.cFirst[k]); });
        if (!nd.linkNext) lc.dSecond.forEach((d, k) => { lc.u += f(d, lc.cSecond[k]); });
        cache[i].set(g, lc);
      }
      return lc;
    };
    return { ctx, f: coverCostFn(ctx), keys: ctx.nodes.map((nd) => tableKey(ctx, nd)), lcOf };
  });
  const table = new Map();
  const byKey = new Map();
  items.forEach((it, ii) => it.keys.forEach((k, i) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push([ii, i]); }));
  for (const k of byKey.keys()) table.set(k, " ");
  // Cost touched by changing one entry: unary of its nodes + both pair windows of each.
  const localCost = (members) => {
    let s = 0;
    const seenU = new Set(), seenP = new Set();
    for (const [ii, i] of members) {
      const it = items[ii], nodes = it.ctx.nodes;
      const lc = (j) => it.lcOf(j, table.get(it.keys[j]));
      if (!seenU.has(ii * 1e6 + i)) { seenU.add(ii * 1e6 + i); s += lc(i).u; }
      if (i > 0 && nodes[i - 1].linkNext && !seenP.has(ii * 1e6 + i)) { seenP.add(ii * 1e6 + i); s += pairCost(it.f, lc(i - 1), lc(i)); }
      if (nodes[i].linkNext && !seenP.has(ii * 1e6 + i + 1)) { seenP.add(ii * 1e6 + i + 1); s += pairCost(it.f, lc(i), lc(i + 1)); }
    }
    return s;
  };
  const cands = [" ", ...vocab];
  for (let pass = 0; pass < passes; pass++) {
    let changed = 0;
    for (const [k, members] of byKey) {
      const was = table.get(k);
      let bestG = was, bestC = Infinity;
      for (const g of cands) {
        table.set(k, g);
        const c = localCost(members);
        if (c < bestC - 1e-12) { bestC = c; bestG = g; }
      }
      table.set(k, bestG);
      if (bestG !== was) changed++;
    }
    if (!changed) break;
  }
  return table;
}
