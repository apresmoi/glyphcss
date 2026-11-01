#!/usr/bin/env node
// Temporal metrics of the CURRENT strategies only (no DP, no tables): the
// quick check after a runtime change.  node bench/line-fidelity/animQuick.mjs [names...]
import path from "node:path";
import { buildSequences, centroids, temporalMetrics } from "./anim.mjs";
import { CACHE, FACES, readJson } from "./common.mjs";
import { compositeCells } from "./composite.mjs";
import { caseCurvePx, caseFrame } from "./geometry.mjs";
import { loadMasks } from "./rasters.mjs";
import { prepareCase, score } from "./rubric.mjs";
import { STRATEGIES } from "./strategies.mjs";

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STRATEGIES);
const rows = [];
for (const name of names) {
  const st = STRATEGIES[name];
  const fm = loadMasks(readJson(path.join(CACHE, `masks-${st.face}.json`)));
  const acc = {};
  const seqs = buildSequences(fm);
  for (const seq of seqs) {
    const frames = [];
    const state = {};
    let i = 0;
    for (const c of seq.frames) {
      const frame = caseFrame(c, fm);
      const curve = caseCurvePx(c, fm, frame.originX, frame.originY);
      const prep = prepareCase(curve, fm.cellW, frame.W, frame.H);
      const cells = st.run(c, fm, 12345 + i++, state).filter((x) => fm.masks.get(x.glyph)?.safe);
      const { img } = compositeCells(fm, cells, frame);
      const cen = centroids(img, frame.W, frame, curve, fm.cellW);
      frames.push({ cells: cells.map(({ col, row, glyph }) => [col, row, glyph]), polylines: c.polylines, total: score(prep, img).total, inkCentroid: cen.ink, trueCentroid: cen.truth });
    }
    const m = { ...temporalMetrics(frames), staticTotal: frames.reduce((a, f) => a + f.total, 0) / frames.length };
    for (const [k, v] of Object.entries(m)) if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v / seqs.length;
  }
  rows.push({ name, face: st.face, ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +v.toFixed(3)])) });
}
console.table(rows);
