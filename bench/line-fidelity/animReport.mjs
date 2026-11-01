// "## Animation" and style-consistency sections of RESULTS.md.
import { STRATEGIES } from "./strategies.mjs";
import { STYLE_WEIGHT, familyOf, styleTerm } from "./style.mjs";

const f2 = (x) => (x === undefined || Number.isNaN(x) ? "–" : x.toFixed(2));
const f3 = (x) => (x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const ownOf = (st) => (st.vocab === "wire" ? "all" : st.vocab);
const METRICS = [
  ["staticTotal", "static total", f3],
  ["changeRate", "change rate", f3],
  ["unjustifiedPerFrame", "unjustified / frame", f2],
  ["flickerPerFrame", "flicker / frame", f2],
  ["jitter", "centroid jitter (cw)", f3],
];

/** Crop frames to their common box so motion stays visible; side by side. */
function strip(title, framesCells, cols, rows, from, n) {
  const sel = framesCells.slice(from, from + n);
  let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
  for (const cells of sel) for (const [c, r] of cells) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
  if (c1 < 0) return `${title}: (blank)`;
  const blocks = sel.map((cells) => {
    const g = Array.from({ length: r1 - r0 + 1 }, () => Array(c1 - c0 + 1).fill(" "));
    for (const [c, r, ch] of cells) g[r - r0][c - c0] = ch;
    return g.map((row) => row.join(""));
  });
  const w = c1 - c0 + 1;
  const head = sel.map((_, i) => `#${from + i}`.padEnd(w)).join(" │ ");
  const lines = [title, head];
  for (let y = 0; y <= r1 - r0; y++) lines.push(blocks.map((b) => b[y]).join(" │ ").trimEnd());
  return lines.join("\n");
}

export function writeAnimationSection(p, anim, staticResults) {
  const { lambdas, margins, vocabs } = anim;
  p("## Animation");
  p();
  p("Eight 60-frame sequences per face, every frame rendered independently on one shared grid (as the renderer does): a 12 cw segment drifting diagonally at 0.05 and 0.3 cell/frame (at 20° and 65°), rotating about its centre at 0.5°/frame and 3°/frame, a circle growing r 4 → 8 cw, and a wiggly polyline drifting 0.1 cell/frame. `wire-*` redraw `Math.random()` per frame (a fresh seed per frame), as a live scene does.");
  p();
  p("Temporal metrics (separate from the static rubric; lower is better):");
  p();
  p("- **change rate**: changed cells per frame ÷ non-blank cells in that frame.");
  p("- **unjustified / frame**: cell glyph changes while the true curve inside that cell (grown by ½ cell) moved < 0.1 cell since the cell last changed. Motion is the farthest any curve point there lies from the other frame's curve, so sliding along itself counts as no motion. Judging against the last change, not the last frame, keeps a slow drift (0.05 cell/frame, always < 0.1 per frame) from making every change unjustified.");
  p("- **flicker / frame**: A→B→A (or A→B→·→A) returns within 3 frames, per cell.");
  p("- **centroid jitter**: RMS over frames of |ink-centroid velocity − true-curve-centroid velocity|, in cw per frame.");
  p();

  const cur = (face) => anim.faces[face].current;
  const avgCur = (face, name, k) => mean(cur(face).map((s) => s.strategies[name]?.[k]).filter((x) => x !== undefined));

  p("### Current strategies (mean over sequences, site face)");
  p();
  p("| strategy | face | " + METRICS.map((m) => m[1]).join(" | ") + " |");
  p("|---|---|" + METRICS.map(() => "---").join("|") + "|");
  for (const [name, st] of Object.entries(STRATEGIES)) p(`| ${name} | ${st.face} | ${METRICS.map(([k, , fmt]) => fmt(avgCur(st.face, name, k))).join(" | ")} |`);
  p();
  const kinds = [...new Set(cur("atlas").map((s) => s.kind))];
  p("Unjustified flips per frame by sequence kind:");
  p();
  p("| strategy | " + kinds.join(" | ") + " |");
  p("|---|" + kinds.map(() => "---").join("|") + "|");
  for (const [name, st] of Object.entries(STRATEGIES)) {
    p(`| ${name} | ${kinds.map((k) => f2(mean(cur(st.face).filter((s) => s.kind === k).map((s) => s.strategies[name]?.unjustifiedPerFrame).filter((x) => x !== undefined)))).join(" | ")} |`);
  }
  p();
  p("### Worst sequences");
  p();
  p("| strategy | most unjustified flips | most flicker |");
  p("|---|---|---|");
  for (const [name, st] of Object.entries(STRATEGIES)) {
    const rows = cur(st.face).filter((s) => s.strategies[name]?.unjustifiedPerFrame !== undefined);
    const u = [...rows].sort((a, b) => b.strategies[name].unjustifiedPerFrame - a.strategies[name].unjustifiedPerFrame)[0];
    const fl = [...rows].sort((a, b) => b.strategies[name].flickerPerFrame - a.strategies[name].flickerPerFrame)[0];
    p(`| ${name} | ${u ? `${u.seq}: ${f2(u.strategies[name].unjustifiedPerFrame)}/frame` : "–"} | ${fl ? `${fl.seq}: ${f2(fl.strategies[name].flickerPerFrame)}/frame` : "–"} |`);
  }
  p();

  // ── Trade-off ──
  p("### Trade-off: static score vs temporal stability");
  p();
  p(`Temporal DP: each frame's DP adds λ per cell whose glyph differs from the PREVIOUS frame's chosen solution (online, causal, no lookahead). Leaving a cell the last frame inked also costs λ, but a cell no node visits any more cannot be charged inside the chain model. The rounds are selected on total + λ·changes. Table + hysteresis: the fitted lookup table, but a cell keeps its previous glyph unless the table's glyph beats it by margin m on the surrogate's solo cost. λ and m are in rubric-total units per cell; a typical stroke totals 0.6–1.2 over ~14–40 cells.`);
  p();
  const rec = {};
  for (const face of Object.keys(anim.faces)) {
    for (const v of vocabs) {
      const dps = anim.faces[face].dp.filter((d) => d.vocab === v);
      if (!dps.length) continue;
      p(`**${face} · ${v}**`);
      p();
      p("| variant | " + METRICS.map((m) => m[1]).join(" | ") + " |");
      p("|---|" + METRICS.map(() => "---").join("|") + "|");
      const rows = [];
      for (const [name, st] of Object.entries(STRATEGIES)) {
        if (st.face !== face || ownOf(st) !== v) continue;
        p(`| current ${name} | ${METRICS.map(([k, , fmt]) => fmt(avgCur(face, name, k))).join(" | ")} |`);
      }
      for (const lam of lambdas) {
        const vals = Object.fromEntries(METRICS.map(([k]) => [k, mean(dps.map((d) => d.lambdas[lam]?.[k]).filter((x) => x !== undefined))]));
        rows.push({ kind: "dp", x: lam, ...vals });
        p(`| DP λ = ${lam} | ${METRICS.map(([k, , fmt]) => fmt(vals[k])).join(" | ")} |`);
      }
      for (const m of margins) {
        const vals = Object.fromEntries(METRICS.map(([k]) => [k, mean(cur(face).map((s) => s.hysteresis[v]?.[m]?.[k]).filter((x) => x !== undefined))]));
        rows.push({ kind: "table", x: m, ...vals });
        p(`| table, margin ${m} | ${METRICS.map(([k, , fmt]) => fmt(vals[k])).join(" | ")} |`);
      }
      p();
      // Recommendation: the largest λ / m whose static total stays within 5% of its own λ=0 / m=0 baseline.
      const pick = (kind) => {
        const rs = rows.filter((r) => r.kind === kind);
        const base = rs[0];
        const ok = rs.filter((r) => r.staticTotal <= base.staticTotal * 1.05);
        return { best: ok.at(-1), base };
      };
      rec[`${face}/${v}`] = { dp: pick("dp"), table: pick("table") };
    }
  }
  p("### Recommended settings");
  p();
  p("Rule: the largest λ (or m) whose mean static total stays within 5 % of the same method at λ = 0 (m = 0). The table shows what it buys.");
  p();
  p("| face / family | DP λ | unjustified / frame (λ=0 → λ) | flicker / frame | static total | table margin m | unjustified / frame (m=0 → m) | flicker / frame | static total |");
  p("|---|---|---|---|---|---|---|---|---|");
  for (const [k, r] of Object.entries(rec)) {
    const d = r.dp, t = r.table;
    p(`| ${k} | ${d.best.x} | ${f2(d.base.unjustifiedPerFrame)} → ${f2(d.best.unjustifiedPerFrame)} | ${f2(d.base.flickerPerFrame)} → ${f2(d.best.flickerPerFrame)} | ${f3(d.base.staticTotal)} → ${f3(d.best.staticTotal)} | ${t.best.x} | ${f2(t.base.unjustifiedPerFrame)} → ${f2(t.best.unjustifiedPerFrame)} | ${f2(t.base.flickerPerFrame)} → ${f2(t.best.flickerPerFrame)} | ${f3(t.base.staticTotal)} → ${f3(t.best.staticTotal)} |`);
  }
  p();
  const msRows = [];
  for (const face of Object.keys(anim.faces)) for (const v of vocabs) {
    const dps = anim.faces[face].dp.filter((d) => d.vocab === v);
    if (dps.length) msRows.push(`${face}/${v} ${f2(mean(dps.flatMap((d) => lambdas.map((l) => d.lambdas[l]?.msPerFrame).filter((x) => x !== undefined))))} ms`);
  }
  p(`Temporal DP cost per frame: ${msRows.join(", ")}.`);
  p();

  // ── Strips ──
  p("### Frame strips (verbatim, 6 consecutive frames, shared crop)");
  p();
  const strips = [
    ["atlas", "drift-slow 20°", "maps-ink", "ink", 20],
    ["atlas", "rotate-slow 0.5°/f", "maps-braille", "braille", 20],
    ["atlas", "circle r4→8", "maps-box", "box", 30],
  ];
  for (const [face, seqId, name, v, from] of strips) {
    const c = cur(face).find((s) => s.seq === seqId);
    const d = anim.faces[face].dp.find((x) => x.seq === seqId && x.vocab === v);
    const lam = rec[`${face}/${v}`]?.dp.best.x;
    if (!c || !d || c.strategies[name]?.frames === undefined) continue;
    p(`**${seqId}** (${face}) — current ${name} vs temporal DP ${v} at λ = ${lam}`);
    p();
    p("```text");
    p(strip(`current ${name}`, c.strategies[name].frames, c.cols, c.rows, from, 6));
    p("");
    p(strip(`DP ${v} λ=${lam}`, d.lambdas[lam].frames, c.cols, c.rows, from, 6));
    p("```");
    p();
  }

  // ── Style ──
  p("## Style consistency");
  p();
  p(`\`style\` = fraction of a stroke's non-blank cells outside its majority visual family (dots = braille and · •; strokes = ASCII punctuation, box drawing, ‾ ▔ ▁ ▏ ▕; blocks; symbols). It is reported next to the static rubric and is NOT in its total (static numbers stay as they were); "+ style" adds ${STYLE_WEIGHT}·style. *DP all + style* runs the DP once per candidate majority family (dots, strokes) with a ${STYLE_WEIGHT}/n unary penalty on off-family glyphs, which is the style term decomposed exactly given the family, and keeps the better on total + style.`);
  p();
  p("| face | variant | static total | style | total + style | dots majority | strokes majority |");
  p("|---|---|---|---|---|---|---|");
  for (const face of Object.keys(anim.faces)) {
    const sty = anim.faces[face].style;
    const byId = new Map(staticResults.cases[face].map((r) => [r.id, r]));
    const plain = sty.map((s) => byId.get(s.id)?.dp.all).filter(Boolean);
    const plainStyle = plain.map((d) => styleTerm(d.cells));
    const share = (arr) => (fam) => `${((arr.filter((x) => x === fam).length / arr.length) * 100).toFixed(0)}%`;
    const majPlain = plain.map((d) => { const n = new Map(); for (const [, , g] of d.cells) n.set(familyOf(g), (n.get(familyOf(g)) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; });
    p(`| ${face} | DP all | ${f3(mean(plain.map((d) => d.score.total)))} | ${f3(mean(plainStyle))} | ${f3(mean(plain.map((d, i) => d.score.total + STYLE_WEIGHT * plainStyle[i])))} | ${share(majPlain)("dots")} | ${share(majPlain)("strokes")} |`);
    p(`| ${face} | DP all + style | ${f3(mean(sty.map((s) => s.score.total)))} | ${f3(mean(sty.map((s) => s.style)))} | ${f3(mean(sty.map((s) => s.score.total + STYLE_WEIGHT * s.style)))} | ${share(sty.map((s) => s.majority))("dots")} | ${share(sty.map((s) => s.majority))("strokes")} |`);
    for (const [name, st] of Object.entries(STRATEGIES)) {
      if (st.face !== face) continue;
      const rs = staticResults.cases[face].map((r) => r.strategies[name]).filter((x) => x?.cells);
      p(`| ${face} | current ${name} | ${f3(mean(rs.map((x) => x.score.total)))} | ${f3(mean(rs.map((x) => styleTerm(x.cells))))} | ${f3(mean(rs.map((x) => x.score.total + STYLE_WEIGHT * styleTerm(x.cells))))} | | |`);
    }
  }
  p();
  const ex = anim.faces.atlas.style.find((s) => s.id === "wiggle 0");
  const exPlain = staticResults.cases.atlas.find((r) => r.id === "wiggle 0");
  if (ex && exPlain) {
    p("**wiggle 0** (atlas): DP all vs DP all + style");
    p();
    p("```text");
    const rec0 = exPlain;
    const toLines = (cells) => { const g = Array.from({ length: rec0.rows }, () => Array(rec0.cols).fill(" ")); for (const [c, r, ch] of cells) g[r][c] = ch; return g.map((r) => r.join("").trimEnd()).filter((l) => l.trim()); };
    const a = toLines(exPlain.dp.all.cells), b = toLines(ex.cells);
    p(`DP all [${f2(exPlain.dp.all.score.total)}, style ${f2(styleTerm(exPlain.dp.all.cells))}]`);
    for (const l of a) p(l);
    p("");
    p(`DP all + style [${f2(ex.score.total)}, style ${f2(ex.style)}]`);
    for (const l of b) p(l);
    p("```");
    p();
  }
}
