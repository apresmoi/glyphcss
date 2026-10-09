/**
 * Skip-level sankey bands and solid ribbons:
 *
 * - the corridor-aware node order: a node receiving a skip-level link sits
 *   where that band can arrive, kept only when the whole layout crosses less;
 * - skip-level bands paint as smooth ribbons on braille/blocks;
 * - no quadrant a turn cell cuts faces the band's own cells (the black notches);
 * - a solid full cell carries its own colour as its background (the seams).
 *
 * Mutation checks against this file are recorded in that design section.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGlyphCanvas, encodeGlyphCanvasHtml } from "glyphcss";
import { describe, expect, it } from "vitest";
import { computeSankeyRoutedRows, layoutSankeyGraph, paintSankeyRoutedRows } from "./flowMarks";
import { ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import { layoutGlyphChart, resolveGlyphChartLegendOption, type GlyphChartPlotRect } from "./layout";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { chartSeries } from "./series";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartSankey } from "./spec";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `flowMarks.test.ts`' layered DAG with skip-level links (same seeds, same graphs). */
function randomLayered(seed: number): GlyphChartSpec {
  const rand = mulberry32(seed + 7919);
  const layers = 3 + Math.floor(rand() * 3);
  const perLayer = Array.from({ length: layers }, () => 1 + Math.floor(rand() * 3));
  const rows: { from: string; to: string; v: number }[] = [];
  for (let l = 0; l < layers - 1; l++) for (let a = 0; a < perLayer[l]!; a++) {
    rows.push({ from: `L${l}N${a}`, to: `L${l + 1}N${Math.floor(rand() * perLayer[l + 1]!)}`, v: 5 + Math.round(rand() * 40) });
    for (let m = l + 2; m < layers; m++) if (rand() < 0.5) rows.push({ from: `L${l}N${a}`, to: `L${m}N${Math.floor(rand() * perLayer[m]!)}`, v: 5 + Math.round(rand() * 40) });
  }
  const dedup = new Map(rows.map((r) => [`${r.from}->${r.to}`, r]));
  return { marks: [glyphChartSankey([...dedup.values()], { source: "from", target: "to", value: "v" })] };
}
/** `flowMarks.test.ts`' bipartite DAG: two columns, so never a skip-level link. */
function randomBipartite(seed: number): GlyphChartSpec {
  const rand = mulberry32(seed);
  const nSources = 1 + Math.floor(rand() * 3);
  const nTargets = 2 + Math.floor(rand() * 12);
  const rows: { from: string; to: string; v: number }[] = [];
  for (let s = 0; s < nSources; s++) for (let t = 0; t < nTargets; t++) if (rand() < 0.6) rows.push({ from: `S${s}`, to: `T${t}`, v: Math.round(Math.exp(rand() * 5)) });
  if (rows.length === 0) rows.push({ from: "S0", to: "T0", v: 1 });
  return { marks: [glyphChartSankey(rows, { source: "from", target: "to", value: "v" })] };
}

const energy: GlyphChartSpec = { marks: [glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" })], title: "National energy flow (illustrative)" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);
function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}

/** The plot rect, sankey layout and routed rows `renderGlyphChart` itself uses (legend off). */
function sankeyGeometry(spec: GlyphChartSpec, charset: GlyphChartCharset, w: number, h: number) {
  const marks = resolveGlyphChartSpec(spec);
  const plot: GlyphChartPlotRect = layoutGlyphChart(spec, marks, resolveGlyphChartScales(marks, spec.scales), w, h, "auto", [], charset, resolveGlyphChartLegendOption(spec.legend, false), 1).plot;
  const layout = layoutSankeyGraph(chartSeries(marks).filter((s) => s.mark.type === "sankey"), plot, charset, [])!;
  const rows = computeSankeyRoutedRows(createGlyphCanvas({ cols: w, rows: h, tier: charset }), plot, layout, false, []);
  return { plot, layout, rows };
}
const lostCells = (spec: GlyphChartSpec, charset: GlyphChartCharset, filter: (source: string, target: string) => boolean = () => true): number =>
  renderGlyphChart(spec, { target: "web", width: 96, height: 32, charset, color: "none", legend: false }).report.ledger
    .filter((e) => e.code === "sankey-band-broken" && filter((e.detail as { source: string }).source, (e.detail as { target: string }).target))
    .reduce((n, e) => n + (e.detail as { cells: number }).cells, 0);

interface Cell { readonly ch: string; readonly fg: string | null; readonly bg: string | null }
function htmlCells(html: string): Cell[][] {
  return html.split("\n").map((line) => {
    const row: Cell[] = [];
    const re = /<span style="([^"]*)">([^<]*)<\/span>|([^<]+)/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const style = m[1] ?? "";
      const text = (m[2] ?? m[3]!).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const fg = /(?:^|;)color:(#[0-9a-f]{6})/.exec(style)?.[1] ?? null;
      const bg = /background-color:(#[0-9a-f]{6})/.exec(style)?.[1] ?? null;
      for (const ch of text) row.push({ ch, fg: ch === " " ? null : fg, bg });
    }
    return row;
  });
}
/** Quadrant glyph -> mask, bit 0 TL, 1 TR, 2 BL, 3 BR. */
const QUAD_MASK = new Map(["▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"].map((g, i) => [g, i + 1]));

/**
 * Every cut quadrant whose two abutting quadrants — across the cell's
 * vertical edge and across its horizontal edge — are both inked in the
 * cell's own colour: a notch of page background enclosed by one band, where
 * a rounded corner can only face out of it. A ribbon's own edge (`▀` over
 * the air row before the next band) abuts empty quadrants and never counts.
 */
function holes(cells: Cell[][]): string[] {
  const out: string[] = [];
  const quadrantInked = (x: number, y: number, q: number, color: string): boolean => {
    const c = cells[y]?.[x];
    if (!c) return false;
    const mask = QUAD_MASK.get(c.ch) ?? 0;
    return mask & (1 << q) ? c.fg === color : c.bg === color;
  };
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[y]!.length; x++) {
    const c = cells[y]![x]!;
    const mask = QUAD_MASK.get(c.ch);
    if (!mask || mask === 15 || c.bg !== null || !c.fg) continue;
    for (let q = 0; q < 4; q++) {
      if (mask & (1 << q)) continue;
      const dx = q % 2 === 1 ? 1 : -1, dy = q >= 2 ? 1 : -1;
      if (quadrantInked(x + dx, y, q ^ 1, c.fg) && quadrantInked(x, y + dy, q ^ 2, c.fg)) out.push(`(${x},${y}) ${c.ch} q${q}`);
    }
  }
  return out;
}

describe("skip-level bands: corridor-aware node order", () => {
  it("the energy sankey puts Industrial below Electricity Generation, where Natural Gas -> Industrial can arrive, on every tier", () => {
    // Mutation: never keep the re-placed order (`alt.reordered && false`) -> red.
    for (const charset of ["ascii", "box", "blocks", "braille"] as const) {
      const { layout } = sankeyGeometry(energy, charset, 96, 32);
      const box = (id: string) => layout.nodes.find((n) => n.id === id)!;
      expect(box("Industrial").y0, charset).toBeGreaterThan(box("Electricity Generation").y1);
      // d3's own order kept the other three, and the three sources.
      expect(layout.nodes.filter((n) => n.x0 === box("Industrial").x0).map((n) => n.id), charset).toEqual(["Residential", "Commercial", "Losses", "Industrial"]);
      expect(layout.nodes.filter((n) => n.x0 === 0).map((n) => n.id), charset).toEqual(["Coal", "Natural Gas", "Nuclear", "Renewables"]);
    }
  });

  it("the energy skip band crosses fewer cells than before Round 3, and no Electricity Generation ribbon loses a cell to it on braille", () => {
    // Before (149e7dfa): box routed footprint 332 cells, 91 of them in another band's; lost cells box 151, braille 119.
    const { layout, rows } = sankeyGeometry(energy, "box", 96, 32);
    const skip = layout.bands.find((b) => b.source === "Natural Gas" && b.target === "Industrial")!;
    const cellsOf = new Map<unknown, Set<number>>();
    for (const r of rows) {
      const set = cellsOf.get(r.band) ?? new Set<number>();
      for (const p of r.cells) set.add(p.y * 96 + p.x);
      cellsOf.set(r.band, set);
    }
    const own = cellsOf.get(skip)!;
    const crossed = [...own].filter((idx) => [...cellsOf].some(([band, set]) => band !== skip && set.has(idx))).length;
    expect(own.size).toBe(282);
    expect(crossed).toBe(45);
    expect(lostCells(energy, "box")).toBe(51);
    expect(lostCells(energy, "braille")).toBe(35);
    expect(lostCells(energy, "braille", (source) => source === "Electricity Generation")).toBe(0);
  });

  it.each(["box", "braille"] as const)("a graph with no skip-level link lays out byte-identically to 149e7dfa (fixtures/sankeyOrderParentFixtures.json) [%s]", (charset) => {
    // Mutation: re-place every node by its barycentre, not only a skip-level target -> red.
    const parent: Record<string, string> = JSON.parse(readFileSync(fixturePath("fixtures/sankeyOrderParentFixtures.json"), "utf8"));
    for (let seed = 0; seed < 40; seed++) {
      const html = renderGlyphChart(randomBipartite(seed), { target: "web", width: 96, height: 32, charset, color: "css", regionFill: "texture" }).html!;
      expect(hash(html), `bipartite ${seed} ${charset}`).toBe(parent[`bipartite:${seed}:${charset}`]);
    }
  });

  it("the re-placed order is kept only where it loses no more cells on either tier family: box renders of the layered sweep change for exactly these seeds", () => {
    // Mutation: keep the re-placed order whenever it differs, without the lost-cell count -> red (more seeds change).
    // Box paints every band through lanes whatever the order, so a box change is the order changing; braille also
    // changes wherever a skip-level band now paints smooth. Round 27 re-pinned this list: the crossing-count gate
    // kept 0, 10, 40, 42, 52 and 79, which lose more cells on box or braille, and refused 58 and 60, which lose fewer.
    const parent: Record<string, string> = JSON.parse(readFileSync(fixturePath("fixtures/sankeyOrderParentFixtures.json"), "utf8"));
    const changed: number[] = [];
    for (let seed = 0; seed < 80; seed++) {
      const text = renderGlyphChart(randomLayered(seed), { target: "web", width: 96, height: 32, charset: "box", color: "none" }).text;
      if (hash(text) !== parent[`layered:${seed}:box`]) changed.push(seed);
    }
    expect(changed).toEqual([6, 25, 32, 48, 58, 60, 66, 74]);
  }, 30_000);
});

describe("skip-level bands paint as smooth ribbons on braille/blocks", () => {
  it("energy, braille: an S-curve into the corridor, a flat run through Electricity Generation's column clear of its box, an S-curve out", () => {
    // Mutation: `sankeyPlanPaintsSmooth` refuses a skip-level band -> red.
    for (const charset of ["braille", "blocks"] as const) {
      const { layout, rows } = sankeyGeometry(energy, charset, 96, 32);
      const eg = layout.nodes.find((n) => n.id === "Electricity Generation")!;
      const skip = rows.filter((r) => r.band.source === "Natural Gas" && r.band.target === "Industrial");
      const segments = skip[0]!.segments!;
      expect(segments, charset).toBeDefined();
      expect(segments.map((s) => [s.x0, s.x1, s.borderX0, s.borderX1]), charset).toEqual([[16, eg.x0 - 1, true, false], [eg.x0, eg.x1, false, false], [eg.x1 + 1, 79, false, true]]);
      const through = segments[1]!;
      expect(through.from, charset).toEqual(through.to);
      expect(through.from[0], charset).toBeGreaterThan(eg.y1);
      expect(segments[0]!.from, charset).toEqual(skip[0]!.band.sourceRowRange);
      expect(segments[2]!.to, charset).toEqual(skip[0]!.band.targetRowRange);
    }
  });

  it("a skip-level band whose corridor is narrower than the band keeps the staircase (layered seed 4, 96x32)", () => {
    const { rows } = sankeyGeometry(randomLayered(4), "braille", 96, 32);
    const band = rows.filter((r) => r.band.source === "L0N1" && r.band.target === "L2N2");
    expect(band.length).toBeGreaterThan(1);
    expect(band.every((r) => r.segments === undefined)).toBe(true);
  });
});

describe("no holes in a solid ribbon", () => {
  it("braille/blocks, solid: every turn of a staircase band is a whole cell and the band has no notch (layered seeds 4 and 6, alone on the canvas)", () => {
    // Mutation: cut the turn's quadrant under a solid fill again (`const q = sankeyCornerMissingQuadrant(...)`) -> red.
    let turns = 0;
    for (const [seed, source, target] of [[4, "L0N1", "L2N2"], [6, "L0N0", "L3N0"]] as const) for (const charset of ["braille", "blocks"] as const) {
      const { layout, rows } = sankeyGeometry(randomLayered(seed), charset, 96, 32);
      const band = rows.filter((r) => r.band.source === source && r.band.target === target);
      expect(band.length, `seed ${seed}: a multi-row band`).toBeGreaterThan(1);
      expect(band.every((r) => r.segments === undefined), `seed ${seed}: a staircase`).toBe(true);
      // Painted alone, so every cell of its route is its own: a notch here is the band's own corner, not a neighbour's.
      const canvas = createGlyphCanvas({ cols: 96, rows: 32, tier: charset });
      paintSankeyRoutedRows(canvas, layout, band, [], new Set(), "filled", 1, "solid");
      for (const r of band) for (let i = 1; i + 1 < r.cells.length; i++) {
        const a = r.cells[i - 1]!, b = r.cells[i]!, c = r.cells[i + 1]!;
        if ((b.x - a.x) === (c.x - b.x) && (b.y - a.y) === (c.y - b.y)) continue;
        turns++;
        expect(canvas.grid.char[b.y * 96 + b.x], `seed ${seed} ${charset} turn (${b.x},${b.y})`).toBe("█");
      }
      expect(holes(htmlCells(encodeGlyphCanvasHtml(canvas))), `seed ${seed} ${charset}`).toEqual([]);
    }
    expect(turns).toBeGreaterThan(20);
  });

  it("the energy sankey, solid, braille/blocks: no notch anywhere", () => {
    // `regionFill: "auto"` explicit — the library's own default is "texture" now.
    for (const charset of ["braille", "blocks"] as const) {
      const html = renderGlyphChart(energy, { target: "web", width: 96, height: 32, charset, color: "css", legend: false, regionFill: "auto" }).html!;
      expect(holes(htmlCells(html)), charset).toEqual([]);
    }
  });
});

describe("a solid full cell carries its own colour as its background", () => {
  const arc: GlyphChartSpec = { marks: [glyphChartArc([{ k: "a", v: 3 }, { k: "b", v: 2 }, { k: "c", v: 4 }], { fill: "k", y: "v" })] };
  const stackedBar: GlyphChartSpec = { marks: [{ ...glyphChartBar([{ x: "a", y: 3, s: "P" }, { x: "a", y: 2, s: "Q" }, { x: "b", y: 4, s: "P" }, { x: "b", y: 1, s: "Q" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } }] };
  const area: GlyphChartSpec = { marks: [{ ...glyphChartArea([{ x: 0, y: 3, s: "P" }, { x: 1, y: 5, s: "P" }, { x: 2, y: 4, s: "P" }, { x: 0, y: 2, s: "Q" }, { x: 1, y: 1, s: "Q" }, { x: 2, y: 3, s: "Q" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } }] };

  it("every inked `█` under a solid fill has bg == fg, on every charset that paints `█`; a texture render writes none", () => {
    // Mutation: drop `paintSolidCellBackgrounds` (or give it the texture canvas) -> red.
    // `regionFill: "auto"` explicit on the "solid" render — the library's own default is "texture" now.
    let full = 0;
    for (const [name, spec] of [["energy", energy], ["arc", arc], ["stacked bar", stackedBar], ["area", area]] as const) for (const charset of ["box", "blocks", "braille"] as const) {
      const solid = htmlCells(renderGlyphChart(spec, { target: "web", width: 60, height: 24, charset, color: "css", regionFill: "auto" }).html!).flat();
      for (const c of solid) if (c.ch === "█" && c.fg) {
        expect(c.bg, `${name} ${charset}`).toBe(c.fg);
        full++;
      }
      const texture = htmlCells(renderGlyphChart(spec, { target: "web", width: 60, height: 24, charset, color: "css", regionFill: "texture" }).html!).flat();
      expect(texture.filter((c) => c.ch === "█" && c.bg !== null), `${name} ${charset} texture`).toEqual([]);
    }
    expect(full).toBeGreaterThan(1000);
  });

  it("Copy ANSI under a solid fill carries the same background on those cells", () => {
    const text = renderGlyphChart(energy, { target: "web", width: 60, height: 24, charset: "braille", color: "truecolor", regionFill: "solid" }).text;
    // A run of full blocks is one SGR run with both a foreground and a matching background.
    const runs = [...text.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+);48;2;(\d+);(\d+);(\d+)m(█+)/g)];
    expect(runs.length).toBeGreaterThan(20);
    for (const m of runs) expect([m[4], m[5], m[6]]).toEqual([m[1], m[2], m[3]]);
  });
});
