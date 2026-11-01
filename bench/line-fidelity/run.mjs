#!/usr/bin/env node
// Line-fidelity experiment: rasters → current strategies → table → DP oracle → RESULTS.md.
//   node bench/line-fidelity/run.mjs [--quick] [--force-rasters] [--workers N] [--M 48] [--report-only]
// Needs `pnpm build:packages` first (strategies run from packages/*/dist).
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { CACHE, FACES, HERE, writeJson } from "./common.mjs";
import { buildCases } from "./geometry.mjs";
import { buildRasters, extendedCandidates, loadMasks, validateComposite } from "./rasters.mjs";
import { writeReport } from "./report.mjs";
import { strategyGlyphs } from "./strategies.mjs";
import { VOCABS } from "./vocab.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const quick = flag("--quick");
const workers = Number(opt("--workers", Math.max(1, Math.min(16, os.cpus().length - 2))));
const M = Number(opt("--M", 48));

const t0 = performance.now();

/** Measured ink centroid / extent of the oriented line glyphs, in cell fractions (row from the cell top, col from its left). */
function glyphPositions(fm) {
  const out = {};
  for (const g of "‾▔-─_▏|│▕/\\") {
    const m = fm.masks.get(g);
    if (!m) continue;
    let s = 0, sx = 0, sy = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < m.a.length; i++) {
      const v = m.a[i], x = (i % m.W) + 0.5, y = Math.floor(i / m.W) + 0.5;
      s += v; sx += v * x; sy += v * y;
      if (v >= 0.3) { y0 = Math.min(y0, y - 0.5); y1 = Math.max(y1, y + 0.5); }
    }
    out[g] = { row: (sy / s - fm.padY) / fm.cellH, col: (sx / s - fm.padX) / fm.cellW, top: (y0 - fm.padY) / fm.cellH, bottom: (y1 - fm.padY) / fm.cellH, inkPerCw: s / fm.cellW };
  }
  return out;
}
const log = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a);

if (flag("--report-only")) {
  const { readJson } = await import("./common.mjs");
  const { meta, results } = readJson(path.join(CACHE, "results.json"));
  const recs = await buildRasters([...new Set([...extendedCandidates(), ...strategyGlyphs()])]);
  meta.glyphPositions = Object.fromEntries(Object.keys(FACES).map((f) => [f, glyphPositions(loadMasks(recs[f]))]));
  writeReport(meta, results, path.join(HERE, "RESULTS.md"));
  log("rewrote RESULTS.md from .cache/results.json");
  process.exit(0);
}

// 1. Rasters (cached) + compositing validation.
const candidates = [...new Set([...extendedCandidates(), ...strategyGlyphs()])];
const recs = await buildRasters(candidates, { force: flag("--force-rasters") });
const faces = Object.fromEntries(Object.keys(FACES).map((f) => [f, loadMasks(recs[f])]));
log("rasters ready", Object.entries(recs).map(([f, r]) => `${f}: cell ${r.cellW.toFixed(3)}×${r.cellH} px, ${Object.values(r.glyphs).filter((g) => g.safe).length}/${candidates.length} safe`).join("; "));
const validation = await validateComposite(faces);
log("compositing vs DOM", Object.entries(validation).map(([f, v]) => `${f} relL1 ${(v.relL1 * 100).toFixed(3)}%`).join(", "));

// 2. Work pool.
const tasks = [];
const caseCounts = {};
for (const face of Object.keys(FACES)) {
  const n = buildCases(faces[face], { quick }).length;
  caseCounts[face] = n;
  const idx = [...Array(n).keys()];
  for (let i = 0; i < n; i += 8) tasks.push({ face, task: { type: "cases", indices: idx.slice(i, i + 8), vocabs: Object.keys(VOCABS), M } });
  for (const v of Object.keys(VOCABS)) tasks.push({ face, task: { type: "table", vocab: v } });
  // Pruning sensitivity: the same DP with 3× wider label sets on a fixed subset.
  const sub = idx.filter((i) => i % Math.max(1, Math.floor(n / 48)) === 0);
  for (let i = 0; i < sub.length; i += 4) tasks.push({ face, task: { type: "cases", indices: sub.slice(i, i + 4), vocabs: ["all", "ink"], M: 3 * M, sensitivity: true } });
}
// Big tasks first so the pool drains evenly.
tasks.sort((a, b) => (b.task.type === "table") - (a.task.type === "table"));
const totalUnits = tasks.reduce((s, t) => s + (t.task.type === "table" ? caseCounts[t.face] : t.task.indices.length), 0);
let doneUnits = 0, lastLog = 0;
const results = { cases: {}, tables: {}, sensitivity: {} };
for (const f of Object.keys(FACES)) { results.cases[f] = []; results.tables[f] = {}; results.sensitivity[f] = []; }

await new Promise((resolve, reject) => {
  let next = 0, running = 0;
  const launch = () => {
    while (running < workers && next < tasks.length) {
      const t = tasks[next++];
      running++;
      const w = new Worker(path.join(HERE, "worker.mjs"), { workerData: { face: t.face, task: t.task, quick } });
      w.on("message", (m) => {
        if (m.progress) {
          doneUnits += m.progress;
          if (performance.now() - lastLog > 15000) { lastLog = performance.now(); log(`progress ${doneUnits}/${totalUnits}`); }
        }
        if (m.done) {
          if (t.task.type === "table") results.tables[t.face][t.task.vocab] = m.done;
          else if (t.task.sensitivity) results.sensitivity[t.face].push(...m.done);
          else results.cases[t.face].push(...m.done);
        }
      });
      w.on("error", reject);
      w.on("exit", (code) => {
        running--;
        if (code !== 0) return reject(new Error(`worker exited ${code}`));
        if (next >= tasks.length && running === 0) resolve();
        else launch();
      });
    }
  };
  launch();
});
log("all tasks done");

const meta = {
  quick, M, workers,
  faces: Object.fromEntries(Object.entries(recs).map(([f, r]) => [f, {
    label: FACES[f].label, cellW: r.cellW, cellH: r.cellH, baseline: r.baseline, phases: r.phases,
    glyphs: Object.fromEntries(Object.entries(r.glyphs).map(([g, x]) => [g, { safe: x.safe, reason: x.reason, ink: x.ink }])),
  }])),
  validation,
  glyphPositions: Object.fromEntries(Object.keys(FACES).map((f) => [f, glyphPositions(faces[f])])),
  candidates: candidates.length,
  runtimeSec: (performance.now() - t0) / 1000,
};
writeJson(path.join(CACHE, "results.json"), { meta, results });
writeReport(meta, results, path.join(HERE, "RESULTS.md"));
log("wrote", path.join(HERE, "RESULTS.md"));
