// Phase 2 worker: animated sequences (current strategies, table + hysteresis,
// temporal DP) and the style-consistency DP on the static cases.
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { buildSequences, centroids, temporalMetrics } from "./anim.mjs";
import { CACHE, readJson } from "./common.mjs";
import { compositeCells } from "./composite.mjs";
import { buildCases, caseCurvePx, caseFrame } from "./geometry.mjs";
import { caseContext, dpSolve, prepareGlyphs, soloCost, tableKey } from "./oracle.mjs";
import { loadMasks } from "./rasters.mjs";
import { prepareCase, score } from "./rubric.mjs";
import { STRATEGIES } from "./strategies.mjs";
import { STYLE_WEIGHT, familyOf, styleTerm } from "./style.mjs";
import { refMassPerCw, safeGlyphs, vocabFor } from "./vocab.mjs";

const { face, task } = workerData;
const fm = loadMasks(readJson(path.join(CACHE, `masks-${face}.json`)));
const gp = prepareGlyphs(fm, safeGlyphs(fm));
const slim = (cells) => cells.map(({ col, row, glyph }) => [col, row, glyph]);
const key = (c, r) => r * 1e5 + c;

function setup(c) {
  const frame = caseFrame(c, fm);
  const curve = caseCurvePx(c, fm, frame.originX, frame.originY);
  const prep = prepareCase(curve, fm.cellW, frame.W, frame.H);
  const evalCells = (cells) => {
    const { img } = compositeCells(fm, cells, frame);
    const sc = score(prep, img);
    const cen = centroids(img, frame.W, frame, curve, fm.cellW);
    return { score: sc, inkCentroid: cen.ink, trueCentroid: cen.truth };
  };
  return { frame, prep, evalCells };
}

/** Run a causal per-frame producer over a sequence; returns metrics + per-frame records. */
function runSequence(seq, produce) {
  const frames = [];
  let prev = new Map();
  for (const c of seq.frames) {
    const s = setup(c);
    const cells = produce(c, s, prev);
    const ev = s.evalCells(cells);
    frames.push({ cells: slim(cells), polylines: c.polylines, total: ev.score.total, style: styleTerm(cells), inkCentroid: ev.inkCentroid, trueCentroid: ev.trueCentroid });
    prev = new Map(cells.map((x) => [key(x.col, x.row), x.glyph]));
  }
  const m = temporalMetrics(frames);
  return { ...m, staticTotal: frames.reduce((a, f) => a + f.total, 0) / frames.length, style: frames.reduce((a, f) => a + f.style, 0) / frames.length, frames: frames.map((f) => f.cells) };
}

const changes = (prev, cells) => {
  const now = new Map(cells.map((x) => [key(x.col, x.row), x.glyph]));
  let n = 0;
  for (const k of new Set([...prev.keys(), ...now.keys()])) if ((prev.get(k) ?? " ") !== (now.get(k) ?? " ")) n++;
  return n;
};

if (task.type === "anim-current") {
  const seq = buildSequences(fm)[task.seq];
  const out = { seq: seq.id, kind: seq.kind, cols: seq.cols, rows: seq.rows, strategies: {}, hysteresis: {} };
  for (const [name, st] of Object.entries(STRATEGIES)) {
    let unavailable = null;
    let frameIdx = 0;
    const state = {};
    const res = runSequence(seq, (c) => {
      const cells = st.run(c, fm, 12345 + frameIdx++, state);
      const miss = cells.filter((x) => !fm.masks.get(x.glyph)?.safe);
      if (miss.length) { unavailable = [...new Set(miss.map((x) => x.glyph))]; return cells.filter((x) => fm.masks.get(x.glyph)?.safe); }
      return cells;
    });
    out.strategies[name] = unavailable ? { unavailable } : res;
  }
  for (const [vocab, entries] of Object.entries(task.tables)) {
    const table = new Map(entries);
    const inVocab = new Set(vocabFor(fm, vocab));
    const ref = refMassPerCw(fm, vocab);
    out.hysteresis[vocab] = {};
    for (const m of task.margins) {
      out.hysteresis[vocab][m] = runSequence(seq, (c, s, prev) => {
        const ctx = caseContext(c, fm, s.frame, s.prep);
        const cells = new Map();
        ctx.nodes.forEach((nd, i) => {
          let g = table.get(tableKey(ctx, nd)) ?? " ";
          const was = prev.get(key(nd.col, nd.row)) ?? " ";
          // Hysteresis: keep the previous glyph unless the table's choice beats it by margin m.
          if (m > 0 && was !== g && (was === " " || inVocab.has(was)) && soloCost(ctx, gp, i, was, ref) <= soloCost(ctx, gp, i, g, ref) + m) g = was;
          if (g !== " ") cells.set(key(nd.col, nd.row), { col: nd.col, row: nd.row, glyph: g });
        });
        return [...cells.values()];
      });
    }
  }
  parentPort.postMessage({ done: out });
} else if (task.type === "anim-dp") {
  const seq = buildSequences(fm)[task.seq];
  const vocab = vocabFor(fm, task.vocab);
  const ref = refMassPerCw(fm, task.vocab);
  const out = { seq: seq.id, kind: seq.kind, vocab: task.vocab, lambdas: {} };
  for (const lam of task.lambdas) {
    let ms = 0;
    const res = runSequence(seq, (c, s, prev) => {
      const ctx = caseContext(c, fm, s.frame, s.prep);
      const rescore = (cells) => s.evalCells(cells).score;
      // Causal temporal term: λ per cell whose glyph differs from the previous frame's chosen solution.
      const extra = lam === 0 ? null : (i, lc) => {
        const nd = ctx.nodes[i];
        let cost = lam * ((prev.get(key(lc.pc, lc.pr)) ?? " ") !== lc.lab.g ? 1 : 0);
        if ((lc.pc !== nd.col || lc.pr !== nd.row) && (prev.get(key(nd.col, nd.row)) ?? " ") !== " ") cost += lam; // vacating a cell the last frame inked
        return cost;
      };
      const t0 = performance.now();
      const r = dpSolve(ctx, gp, vocab, ref, rescore, { M: task.M, extra, objective: (sc, cells) => sc.total + lam * changes(prev, cells) });
      ms += performance.now() - t0;
      return r.cells;
    });
    out.lambdas[lam] = { ...res, msPerFrame: ms / seq.frames.length };
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: out });
} else if (task.type === "style") {
  const cases = buildCases(fm);
  const vocab = vocabFor(fm, "all");
  const ref = refMassPerCw(fm, "all");
  const out = [];
  for (const idx of task.indices) {
    const c = cases[idx];
    const s = setup(c);
    const ctx = caseContext(c, fm, s.frame, s.prep);
    const rescore = (cells) => s.evalCells(cells).score;
    let best = null;
    for (const fam of ["dots", "strokes"]) {
      const w = STYLE_WEIGHT / Math.max(1, ctx.nodes.length);
      const r = dpSolve(ctx, gp, vocab, ref, rescore, { M: task.M, extra: (i, lc) => (lc.lab.g !== " " && familyOf(lc.lab.g) !== fam ? w : 0), objective: (sc, cells) => sc.total + STYLE_WEIGHT * styleTerm(cells) });
      if (!best || r.objective < best.objective) best = { ...r, fam };
    }
    out.push({ id: c.id, family: c.family, score: best.score, style: styleTerm(best.cells), majority: best.fam, cells: slim(best.cells) });
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: out });
}
