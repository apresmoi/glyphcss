/**
 * The skip-level sankey gates judge by cells LOST, never a weighted
 * crossing-count proxy (it kept re-placements that lost more cells): the corridor-aware node order is kept only where it loses no
 * more cells on either tier family, and a skip-level band paints as a smooth
 * ribbon only where that loses no more cells than its staircase route.
 *
 * `fixtures/sankeyLostParentFixtures.json` is b662a509's own lost-cell count
 * (`sankey-band-broken`, summed) for every render of the seeded layered sweep
 * — d3's order, staircase skip-level bands. Mutation checks against this file
 * are recorded in that design section.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutSankeyGraph, sankeyLostCells } from "./flowMarks";
import { ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import { layoutGlyphChart, resolveGlyphChartLegendOption } from "./layout";
import { renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { chartSeries } from "./series";
import { glyphChartSankey } from "./spec";
import type { GlyphChartCharset, GlyphChartRenderOptions, GlyphChartSpec } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `flowMarks.test.ts`' and `skipLevelSankey.test.ts`' layered DAG with skip-level links (same seeds, same graphs). */
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
function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
const lostCells = (spec: GlyphChartSpec, opts: GlyphChartRenderOptions): number =>
  renderGlyphChart(spec, opts).report.ledger
    .filter((e) => e.code === "sankey-band-broken")
    .reduce((n, e) => n + (e.detail as { cells: number }).cells, 0);
/** The plot rect and sankey layout `renderGlyphChart` itself uses. */
function sankeyGeometry(spec: GlyphChartSpec, charset: GlyphChartCharset, w: number, h: number, legend: boolean | undefined, textScale = 1) {
  const marks = resolveGlyphChartSpec(spec);
  const plot = layoutGlyphChart(spec, marks, resolveGlyphChartScales(marks, spec.scales), w, h, "auto", [], charset, resolveGlyphChartLegendOption(spec.legend, legend), textScale).plot;
  const layout = layoutSankeyGraph(chartSeries(marks).filter((s) => s.mark.type === "sankey"), plot, charset, [], textScale)!;
  return { plot, layout };
}

const SIZES = [[96, 32], [160, 32], [240, 40], [72, 24]] as const;

describe("the skip-level gates never lose more cells than b662a509 (fixtures/sankeyLostParentFixtures.json)", () => {
  it.each(SIZES.map(([w, h]) => ({ w, h })))("$w x $h: every seed of the layered sweep, box and braille, and the gate's own count is the render's", ({ w, h }) => {
    // Mutations: keep the re-placed order whenever it differs -> red (seed 79 at 96x32 box, 132 -> 147);
    // paint every skip-level band smooth -> red on braille; count a band's own revisit as a loss -> the equality reddens.
    const parent: Record<string, number> = JSON.parse(readFileSync(fixturePath("fixtures/sankeyLostParentFixtures.json"), "utf8"));
    let better = 0;
    for (let seed = 0; seed < 80; seed++) for (const charset of ["box", "braille"] as const) {
      const spec = randomLayered(seed);
      const key = `${seed}:${w}x${h}:${charset}`;
      const lost = lostCells(spec, { target: "web", width: w, height: h, charset, color: "none", legend: false });
      expect(lost, key).toBeLessThanOrEqual(parent[key]!);
      if (lost < parent[key]!) better++;
      const { plot, layout } = sankeyGeometry(spec, charset, w, h, false);
      expect(sankeyLostCells(layout, plot, charset === "braille", "filled"), key).toBe(lost);
    }
    expect(better).toBeGreaterThan(0);
  }, 60_000);

  it("the count is exact under the page's own title and legend, an outline ribbon, and textScale 2", () => {
    // Mutation: `sankeyLostCells` ignores the mark's ribbon -> red.
    const energy: GlyphChartSpec = { marks: [glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" })], title: "National energy flow (illustrative)" };
    const outline = (spec: GlyphChartSpec): GlyphChartSpec => ({ ...spec, marks: [{ ...spec.marks[0]!, options: { ...spec.marks[0]!.options, ribbon: "outline" } }] });
    let checked = 0;
    for (const spec of [energy, outline(energy), ...Array.from({ length: 6 }, (_, s) => randomLayered(s)), ...Array.from({ length: 6 }, (_, s) => outline(randomLayered(s)))]) {
      for (const charset of ["ascii", "box", "blocks", "braille"] as const) for (const textScale of [1, 2]) {
        const [w, h] = [96 * textScale, 32 * textScale];
        const lost = lostCells(spec, { target: "web", width: w, height: h, charset, color: "none", textScale });
        const { plot, layout } = sankeyGeometry(spec, charset, w, h, undefined, textScale);
        expect(sankeyLostCells(layout, plot, charset === "braille" || charset === "blocks", spec.marks[0]!.options?.ribbon ?? "filled", textScale), `${charset} ts${textScale}`).toBe(lost);
        if (lost > 0) checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  }, 60_000);
});
