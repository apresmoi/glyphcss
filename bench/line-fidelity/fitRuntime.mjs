#!/usr/bin/env node
// Fits the line-glyph lookup tables the RUNTIME ships (packages/glyphcss/src/render/lineTables.ts):
// one table per vocabulary, fitted jointly over both site faces so one table
// serves every font, densified so every key the runtime can produce has a glyph.
//   node bench/line-fidelity/fitRuntime.mjs [--quick] [--check]
// --check only re-scores the shipped tables (no fit, no write).
// Needs the rasters cached by run.mjs.
import fs from "node:fs";
import path from "node:path";
import { CACHE, FACES, ROOT, readJson } from "./common.mjs";
import { compositeCells } from "./composite.mjs";
import { buildCases, caseCurvePx, caseFrame } from "./geometry.mjs";
import { TABLE_ANGLE_BUCKETS, TABLE_OFFSET_BINS, caseContext, fitTable, prepareGlyphs, tableCells } from "./oracle.mjs";
import { loadMasks } from "./rasters.mjs";
import { prepareCase, score } from "./rubric.mjs";
import { refMassPerCw, safeGlyphs, vocabFor } from "./vocab.mjs";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const check = args.includes("--check");
const OUT = path.join(ROOT, "packages/glyphcss/src/render/lineTables.ts");
const VOCABS = ["ink", "box", "ascii"];
// The bench's "ascii" family is every printable ASCII glyph; the rubric then
// draws verticals as ";" and lifted rules as "^", which score well on ink
// distance but read as punctuation, not lines. The runtime table keeps to
// glyphs people read as strokes.
const RUNTIME_PICK = { ascii: (g) => "-_|/\\'`,.".includes(g) };
const KEYS = TABLE_ANGLE_BUCKETS * 2 * TABLE_OFFSET_BINS;

const faces = Object.keys(FACES).map((face) => {
  const fm = loadMasks(readJson(path.join(CACHE, `masks-${face}.json`)));
  const gp = prepareGlyphs(fm, safeGlyphs(fm));
  const cases = buildCases(fm, { quick }).map((c) => {
    const frame = caseFrame(c, fm);
    const prep = prepareCase(caseCurvePx(c, fm, frame.originX, frame.originY), fm.cellW, frame.W, frame.H);
    return { c, frame, prep, rescore: (cells) => score(prep, compositeCells(fm, cells, frame).img) };
  });
  return { face, fm, gp, cases };
});

// Holdout: fit on lines at multiples of 4° (+ every curve), report the rest separately.
const isTrain = (c) => c.family !== "line" || c.params.deg % 4 === 0;

/** Every key filled: missing keys copy the nearest fitted key (same bucket other axis, then nearer offset, then nearer bucket). */
function densify(table) {
  const dec = (k) => ({ b: Math.floor(k / (2 * TABLE_OFFSET_BINS)), ax: Math.floor(k / TABLE_OFFSET_BINS) % 2, o: k % TABLE_OFFSET_BINS });
  const out = [];
  for (let k = 0; k < KEYS; k++) {
    if (table.has(k)) { out.push(table.get(k)); continue; }
    const t = dec(k);
    let best = " ", bestD = Infinity;
    const middleBin = Math.abs(t.o + 0.5 - TABLE_OFFSET_BINS / 2) < TABLE_OFFSET_BINS / 4;
    for (const [k2, g] of table) {
      if (middleBin && g === " ") continue;
      const u = dec(k2);
      const db = Math.min(Math.abs(u.b - t.b), TABLE_ANGLE_BUCKETS - Math.abs(u.b - t.b));
      const d = db * 10 + Math.abs(u.o - t.o) * 3 + (u.ax !== t.ax ? 1 : 0);
      if (d < bestD) { bestD = d; best = g; }
    }
    out.push(best);
  }
  return out.join("");
}

function evaluate(tableStr) {
  const table = new Map([...tableStr].map((g, k) => [k, g]));
  const res = {};
  for (const { face, fm, cases, gp } of faces) {
    let train = 0, nt = 0, hold = 0, nh = 0;
    for (const x of cases) {
      const ctx = caseContext(x.c, fm, x.frame, x.prep);
      const s = x.rescore(tableCells(ctx, table)).total;
      if (isTrain(x.c)) { train += s; nt++; } else { hold += s; nh++; }
    }
    res[face] = { train: train / nt, holdout: nh ? hold / nh : NaN };
  }
  return res;
}

const shipped = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (check) {
  for (const v of VOCABS) {
    const m = shipped.match(new RegExp(`${v}: "((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) { console.log(v, "not shipped"); continue; }
    console.log(v, JSON.stringify(evaluate(JSON.parse(`"${m[1]}"`))));
  }
  process.exit(0);
}

const tables = {};
for (const v of VOCABS) {
  // Only glyphs every face can draw: one table serves both.
  const shared = faces.map(({ fm }) => new Set(vocabFor(fm, v))).reduce((a, b) => new Set([...a].filter((g) => b.has(g))));
  const vocab = [...shared].filter(RUNTIME_PICK[v] ?? (() => true));
  const ctxs = faces.flatMap(({ fm, gp, cases }) => cases.filter((x) => isTrain(x.c)).map((x) => Object.assign(caseContext(x.c, fm, x.frame, x.prep), { gp, refMassPerCw: refMassPerCw(fm, v) })));
  const t0 = performance.now();
  // The runtime draws exactly one cell per major column, the one the line
  // crosses (`inkLineCell`): its offset always lands in the middle bins, where
  // a blank would be a gap, and the outer bins are never drawn. Fit under
  // that same placement.
  const middle = (k) => Math.abs((k % TABLE_OFFSET_BINS) + 0.5 - TABLE_OFFSET_BINS / 2) < TABLE_OFFSET_BINS / 4;
  const table = fitTable(ctxs, faces[0].gp, vocab, refMassPerCw(faces[0].fm, v), { allow: (k, g) => (g === " ") !== middle(k) });
  tables[v] = densify(table);
  console.log(`${v}: fit ${((performance.now() - t0) / 1000).toFixed(1)} s on ${ctxs.length} cases, ${table.size}/${KEYS} keys seen`, JSON.stringify(evaluate(tables[v])));
}

const rows = (s) => {
  const lines = [];
  for (let b = 0; b < TABLE_ANGLE_BUCKETS; b++) {
    for (let ax = 0; ax < 2; ax++) {
      const o = (b * 2 + ax) * TABLE_OFFSET_BINS;
      lines.push(` *   ${String(((b * 180) / TABLE_ANGLE_BUCKETS).toFixed(2)).padStart(6)}° ${ax ? "col" : "row"}  ${[...s.slice(o, o + TABLE_OFFSET_BINS)].map((g) => (g === " " ? "␣" : g)).join(" ")}`);
    }
  }
  return lines.join("\n");
};

fs.writeFileSync(OUT, `// GENERATED by bench/line-fidelity/fitRuntime.mjs — do not edit by hand; re-run the fit.
//
// Line-glyph lookup tables, fitted against real-font rasters of both site
// faces (GlyphCssAtlas and Glyph Mono) to minimise the line-fidelity rubric
// (distance to the true curve, gaps, stray ink, angle error, weight
// evenness). Key = (visual tangent angle in ${TABLE_ANGLE_BUCKETS} buckets of ${180 / TABLE_ANGLE_BUCKETS}° centred
// on 0°, major axis in cell units, offset of the line from the cell centre
// along the minor axis in ${TABLE_OFFSET_BINS} bins over [-1, 1) cells): index
// (bucket * 2 + (rowMajor ? 0 : 1)) * ${TABLE_OFFSET_BINS} + offsetBin.

/**
 * Rows: bucket centre, major axis; columns: offset bins (negative = the line
 * passes above / left of the centre).
 *
 * ink
${rows(tables.ink)}
 *
 * box
${rows(tables.box)}
 *
 * ascii
${rows(tables.ascii)}
 */
export const LINE_GLYPH_TABLES = {
${VOCABS.map((v) => `  ${v}: ${JSON.stringify(tables[v])},`).join("\n")}
} as const;

export type LineGlyphVocab = keyof typeof LINE_GLYPH_TABLES;

export const LINE_TABLE_ANGLE_BUCKETS = ${TABLE_ANGLE_BUCKETS};
export const LINE_TABLE_OFFSET_BINS = ${TABLE_OFFSET_BINS};
`);
console.log("wrote", path.relative(ROOT, OUT));
