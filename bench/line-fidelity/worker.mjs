// Worker: scores current strategies, runs the DP oracle and fits/evaluates
// lookup tables for a slice of cases of one face.
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { CACHE, readJson } from "./common.mjs";
import { compositeCells } from "./composite.mjs";
import { buildCases, caseCurvePx, caseFrame } from "./geometry.mjs";
import { caseContext, dpSolve, fitTable, prepareGlyphs, tableCells } from "./oracle.mjs";
import { loadMasks } from "./rasters.mjs";
import { prepareCase, score } from "./rubric.mjs";
import { STRATEGIES } from "./strategies.mjs";
import { VOCABS, refMassPerCw, safeGlyphs, vocabFor } from "./vocab.mjs";

const { face, task } = workerData;
const fm = loadMasks(readJson(path.join(CACHE, `masks-${face}.json`)));
const cases = buildCases(fm, { quick: workerData.quick });
const gp = prepareGlyphs(fm, safeGlyphs(fm));

function setup(c) {
  const frame = caseFrame(c, fm);
  const prep = prepareCase(caseCurvePx(c, fm, frame.originX, frame.originY), fm.cellW, frame.W, frame.H);
  const rescore = (cells) => score(prep, compositeCells(fm, cells, frame).img);
  return { frame, prep, rescore };
}

const slim = (cells) => cells.map(({ col, row, glyph }) => [col, row, glyph]);

if (task.type === "cases") {
  const out = [];
  for (const idx of task.indices) {
    const c = cases[idx];
    const { frame, prep, rescore } = setup(c);
    const rec = { id: c.id, family: c.family, params: c.params, cols: c.cols, rows: c.rows, polylines: c.polylines, strategies: {}, dp: {} };
    for (const [name, st] of Object.entries(STRATEGIES)) {
      const cells = st.run(c, fm);
      const missing = [...new Set(cells.map((x) => x.glyph).filter((g) => !fm.masks.get(g)?.safe))];
      if (missing.length) { rec.strategies[name] = { unavailable: missing }; continue; }
      rec.strategies[name] = { score: rescore(cells), cells: slim(cells) };
    }
    const ctx = caseContext(c, fm, frame, prep);
    for (const v of task.vocabs) {
      const vocab = vocabFor(fm, v);
      const t0 = performance.now();
      const res = dpSolve(ctx, gp, vocab, refMassPerCw(fm, v), rescore, { M: task.M });
      rec.dp[v] = { score: res.score, cells: slim(res.cells), ms: performance.now() - t0, K: res.K, n: res.n, M: res.M, labels: res.labels, conflicts: res.conflicts, round: res.round };
    }
    out.push(rec);
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: out });
} else if (task.type === "table") {
  // Fit on a training subset, evaluate on every case.
  const vocab = vocabFor(fm, task.vocab);
  const ref = refMassPerCw(fm, task.vocab);
  const train = cases.filter((c) => c.family !== "line" || c.params.deg % 10 === 0);
  const t0 = performance.now();
  const ctxs = train.map((c) => { const { frame, prep } = setup(c); return caseContext(c, fm, frame, prep); });
  const table = fitTable(ctxs, gp, vocab, ref);
  const fitMs = performance.now() - t0;
  ctxs.length = 0;
  const evals = [];
  for (const c of cases) {
    const { frame, prep, rescore } = setup(c);
    const ctx = caseContext(c, fm, frame, prep);
    const cells = tableCells(ctx, table);
    evals.push({ id: c.id, score: rescore(cells), cells: slim(cells) });
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ done: { vocab: task.vocab, label: VOCABS[task.vocab].label, table: [...table.entries()], trainCases: train.length, fitMs, evals } });
}
