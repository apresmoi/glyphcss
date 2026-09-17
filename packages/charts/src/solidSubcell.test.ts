/**
 * `regionFill` follow-ups:
 *
 * - A: sankey ribbons, node-adjacent routes and funnel bars follow the
 *   whole-chart `regionFill` decision like every other region mark, without
 *   touching which cells a band claims.
 * - B: under a SOLID fill on `braille`/`blocks`, a boundary between two
 *   bands lands on the nearest HALF cell — `▄` in the lower band's colour
 *   over the canvas `bg` of the upper one — and a stack layer thinner than
 *   half a row still shows wherever it is non-zero.
 *
 * Mutation checks against this file are recorded in that design section.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGlyphCanvas } from "glyphcss";
import { describe, expect, it } from "vitest";
import { ECOMMERCE_FUNNEL_DATA, ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import { bandColRange, layoutGlyphChart, resolveGlyphChartLegendOption, scaleToCol, scaleToRowExact } from "./layout";
import type { GlyphChartLedgerEntry } from "./ledger";
import { paintGlyphChart } from "./paint";
import { glyphChartRegionFill, renderGlyphChart } from "./render";
import { resolveGlyphChartSpec } from "./resolve";
import { goodSpecs } from "./reviewFixtures";
import { resolveGlyphChartScales } from "./scales";
import { chartSeries, resolveSeriesColor } from "./series";
import { glyphChartArea, glyphChartBar, glyphChartFunnel, glyphChartLine, glyphChartRect, glyphChartSankey, normalizeGlyphChartInput } from "./spec";
import type { GlyphChartCharset, GlyphChartRenderOptions, GlyphChartSpec } from "./types";
import { validateGlyphChartSpec } from "./validate";

const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
const QUADRANTS = new Set(["▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"]);
const isBrailleDot = (ch: string): boolean => ch.codePointAt(0)! > 0x2800 && ch.codePointAt(0)! <= 0x28ff;

const YEARS: Record<string, Record<string, number>> = {
  "1980": { "Fossil fuels": 70684.05, "Nuclear": 2157.35, "Renewables": 2011.78, "Traditional biomass": 10000 },
  "1985": { "Fossil fuels": 73940.64, "Nuclear": 4511.88, "Renewables": 2444.55, "Traditional biomass": 10541 },
  "1990": { "Fossil fuels": 83071.25, "Nuclear": 6062.41, "Renewables": 2879.68, "Traditional biomass": 11111 },
  "1995": { "Fossil fuels": 86596.98, "Nuclear": 7037.97, "Renewables": 3339.47, "Traditional biomass": 11785 },
  "2000": { "Fossil fuels": 94434.00, "Nuclear": 7820.20, "Renewables": 3727.19, "Traditional biomass": 12500 },
  "2005": { "Fossil fuels": 110553.24, "Nuclear": 8389.71, "Renewables": 4419.03, "Traditional biomass": 12076 },
  "2010": { "Fossil fuels": 121765.15, "Nuclear": 8389.61, "Renewables": 6090.43, "Traditional biomass": 11667 },
  "2015": { "Fossil fuels": 129677.21, "Nuclear": 7805.56, "Renewables": 8016.85, "Traditional biomass": 11111 },
  "2020": { "Fossil fuels": 129419.04, "Nuclear": 8155.18, "Renewables": 10508.34, "Traditional biomass": 11111 },
  "2024": { "Fossil fuels": 142532.37, "Nuclear": 8531.21, "Renewables": 13430.05, "Traditional biomass": 11111 },
};
const SOURCES = ["Fossil fuels", "Nuclear", "Renewables", "Traditional biomass"];
const energyRows = Object.entries(YEARS).flatMap(([year, s]) => Object.entries(s).map(([source, twh]) => ({ year: `${year}-01-01`, source, twh })));
const energyArea: GlyphChartSpec = { marks: [{ ...glyphChartArea(energyRows, { x: "year", y: "twh", fill: "source" }), transform: { kind: "stack" } }], title: "World primary energy consumption by source" };
const stackedBar: GlyphChartSpec = { marks: [{ ...glyphChartBar([{ x: "a", y: 3, s: "P" }, { x: "a", y: 2, s: "Q" }, { x: "a", y: 4, s: "R" }, { x: "b", y: 4, s: "P" }, { x: "b", y: 1, s: "Q" }, { x: "b", y: 2, s: "R" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } }] };
const energySankey: GlyphChartSpec = { marks: [glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" })] };
const funnel: GlyphChartSpec = { marks: [glyphChartFunnel(ECOMMERCE_FUNNEL_DATA, { stage: "stage", value: "count" })] };
const fan: GlyphChartSpec = { marks: [glyphChartSankey([
  { a: "In A", b: "Hub", v: 30 }, { a: "In B", b: "Hub", v: 20 }, { a: "In C", b: "Hub", v: 10 },
  { a: "Hub", b: "Out X", v: 25 }, { a: "Hub", b: "Out Y", v: 25 }, { a: "In A", b: "Out Y", v: 5 },
], { source: "a", target: "b", value: "v" })] };
// `regionFill: "auto"` explicit: the library's own default is now "texture"
// (glyphcss AGENTS.md/render.ts's `GLYPH_CHART_DEFAULT_REGION_FILL`), but
// every test in this file is exercising the SOLID sub-cell painter, which
// auto still resolves to for these colour-distinct fixtures.
const WEB: GlyphChartRenderOptions = { target: "web", width: 96, height: 32, charset: "braille", color: "css", regionFill: "auto" };

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

function ansiTruecolorCells(text: string): Cell[][] {
  return text.split("\n").map((line) => {
    const row: Cell[] = [];
    let fg: string | null = null, bg: string | null = null;
    const hex = (r: string, g: string, b: string) => `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
    const re = /\x1b\[([0-9;]*)m|([^\x1b]+)/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[1] !== undefined) {
        const codes = m[1].split(";");
        if (m[1] === "0" || m[1] === "") { fg = null; bg = null; continue; }
        for (let i = 0; i < codes.length; i++) {
          if (codes[i] === "38" && codes[i + 1] === "2") { fg = hex(codes[i + 2]!, codes[i + 3]!, codes[i + 4]!); i += 4; }
          else if (codes[i] === "48" && codes[i + 1] === "2") { bg = hex(codes[i + 2]!, codes[i + 3]!, codes[i + 4]!); i += 4; }
        }
      } else for (const ch of m[2]!) row.push({ ch, fg: ch === " " ? null : fg, bg });
    }
    return row;
  });
}

/** The stacked-area geometry, derived from the data and the render's own scales — never from the painter. */
function energyGeometry(width: number, height: number, charset: GlyphChartCharset) {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(energyArea));
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", [], charset, resolveGlyphChartLegendOption(spec.legend, undefined), 1);
  const colors = chartSeries(marks).map((s) => resolveSeriesColor(s, true)!);
  const years = Object.keys(YEARS);
  const cols = years.map((y) => scaleToCol(scales.x, layout.plot, `${y}-01-01`));
  // Cumulative stack edges per year: edges[k] is the top of layer k-1 (edges[0] = the baseline).
  const edgesAt = years.map((y) => {
    const e = [0];
    for (const s of SOURCES) e.push(e[e.length - 1]! + YEARS[y]![s]!);
    return e.map((v) => scaleToRowExact(scales.y, layout.plot, v));
  });
  /** Exact row of stack edge `k` at exact column `x` (linear between the year columns). */
  const edge = (k: number, xRaw: number): number => {
    const x = Math.min(cols[cols.length - 1]!, Math.max(cols[0]!, xRaw));
    for (let i = 0; i < cols.length - 1; i++) {
      if (x < cols[i]! || x > cols[i + 1]!) continue;
      const t = cols[i] === cols[i + 1] ? 0 : (x - cols[i]!) / (cols[i + 1]! - cols[i]!);
      return edgesAt[i]![k]! + (edgesAt[i + 1]![k]! - edgesAt[i]![k]!) * t;
    }
    return NaN;
  };
  return { layout, colors, cols, edge };
}

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);

describe("A: sankey and funnel follow regionFill", () => {
  it("web + css resolves solid for a sankey and a funnel; terminal, colour off, one hex and ansi16 keep textures", () => {
    // Mutation: put sankey/funnel back behind the flow-mark clause (or drop them from SOLID_CAPABLE_MARK_TYPES) -> red.
    for (const spec of [energySankey, funnel, fan]) {
      expect(glyphChartRegionFill(spec, WEB)).toMatchObject({ fill: "solid", reason: "colors-distinct" });
      expect(glyphChartRegionFill(spec, { target: "terminal", regionFill: "auto" })).toMatchObject({ fill: "texture", reason: "target-terminal" });
      expect(glyphChartRegionFill(spec, { ...WEB, color: "none" })).toMatchObject({ fill: "texture", reason: "color-off" });
      const oneHex = { marks: [{ ...spec.marks[0]!, options: { ...spec.marks[0]!.options, color: "#ff0000" } }] };
      expect(glyphChartRegionFill(oneHex, WEB)).toMatchObject({ fill: "texture", reason: "colors-collide" });
    }
    // Five sankey sources: ansi16 maps the palette's blue and green to one teal.
    expect(glyphChartRegionFill(energySankey, { ...WEB, color: "ansi16" })).toMatchObject({ fill: "texture", reason: "colors-collide", colliding: ["Coal", "Nuclear"] });
    // A stacked bar next to a sankey is now solid as a whole chart.
    expect(glyphChartRegionFill({ marks: [...stackedBar.marks, ...energySankey.marks] }, WEB).fill).toBe("solid");
  });

  it("braille: a solid sankey paints its ribbons in quadrant blocks, never braille dots or textures, while the plain exits keep them", () => {
    // Mutation: keep `subGlyph` (braille dots) for a solid smooth ribbon -> red.
    const r = renderGlyphChart(energySankey, WEB);
    const solid = htmlCells(r.html!).flat();
    expect(solid.filter((c) => isBrailleDot(c.ch))).toEqual([]);
    for (const g of ["░", "▒", "▓", "╱", "═"]) expect(solid.some((c) => c.ch === g), g).toBe(false);
    expect(solid.filter((c) => c.ch === "█").length).toBeGreaterThan(400);
    expect(r.build.canvas.grid.char.filter(isBrailleDot).length).toBeGreaterThan(400);
  });

  it("box: solid ribbons and funnel bars are `█` with square corners; the texture fallback's lighter run and rounded corners are gone", () => {
    // Mutation: return the lighter straight glyph, or the rounded corner, under solid -> red.
    for (const spec of [energySankey, fan, funnel]) {
      const rows = htmlCells(renderGlyphChart(spec, { ...WEB, charset: "box" }).html!).flat();
      for (const g of ["░", "▚", "╱", "▌", "═", "▓", "▒", "╭", "╮", "╰", "╯"]) expect(rows.some((c) => c.ch === g), `${g} in ${spec.marks[0]!.type}`).toBe(false);
      expect(rows.filter((c) => c.ch === "█").length).toBeGreaterThan(50);
    }
    const texture = htmlCells(renderGlyphChart(energySankey, { ...WEB, charset: "box", regionFill: "texture" }).html!).flat();
    expect(texture.some((c) => c.ch === "▓")).toBe(true);
  });

  it("solid claims exactly the texture paint's cells: same footprint, same ledger (borders, breaks, folds), same route conflicts", () => {
    // Mutation: skip a solid ribbon cell the texture paint writes (e.g. `if (solid && !isBorderCol && mask === 0xff) continue`) -> red.
    const sizes: readonly [number, number][] = [[40, 20], [72, 24], [96, 32], [140, 40]];
    const outline = { marks: [{ ...energySankey.marks[0]!, options: { ribbon: "outline" as const } }] };
    for (const spec of [energySankey, fan, funnel, outline]) {
      const valid = validateGlyphChartSpec(normalizeGlyphChartInput(spec));
      const marks = resolveGlyphChartSpec(valid);
      const scales = resolveGlyphChartScales(marks, valid.scales);
      for (const charset of CHARSETS) for (const [w, h] of sizes) {
        const layout = layoutGlyphChart(valid, marks, scales, w, h, "auto", [], charset, resolveGlyphChartLegendOption(valid.legend, undefined), 1);
        const paint = (regionFill: "solid" | "texture") => {
          const canvas = createGlyphCanvas({ cols: w, rows: h, tier: charset });
          const ledger: GlyphChartLedgerEntry[] = [];
          paintGlyphChart(canvas, valid, marks, scales, layout, { colorEnabled: true, regionFill }, ledger);
          const footprint = canvas.grid.char.flatMap((c, i) => (c !== " " && c !== "⠀" ? [i] : []));
          return { footprint, ledger, conflicts: canvas.report.routeConflicts, colors: canvas.grid.color };
        };
        const t = paint("texture"), s = paint("solid");
        const key = `${spec === outline ? "outline" : spec.marks[0]!.type}:${charset}:${w}x${h}`;
        expect(s.footprint, key).toEqual(t.footprint);
        expect(s.ledger, key).toEqual(t.ledger);
        expect(s.conflicts, key).toEqual(t.conflicts);
        // Every painted cell keeps its owner: a band's colour never moves to another band's cell.
        expect(s.colors, key).toEqual(t.colors);
      }
    }
  });

  it("solid ribbons carry their source's own colour; the swatches are `█`", () => {
    // Mutation: leave the sankey/funnel legend swatch on `seriesShade` -> red.
    const cells = htmlCells(renderGlyphChart(energySankey, WEB).html!);
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(energySankey));
    const sourceColors = new Set(chartSeries(resolveGlyphChartSpec(valid)).map((s) => resolveSeriesColor(s, true)!));
    const inked = cells.flat().filter((c) => QUADRANTS.has(c.ch));
    expect(new Set(inked.map((c) => c.fg))).toEqual(sourceColors);
    const legend = cells[cells.length - 1]!.map((c) => c.ch).join("");
    expect(legend).toMatch(/█ {2}Coal +█ {2}Natural Gas +█ {2}Nuclear +█ {2}Renewables/);
    const funnelLegend = renderGlyphChart(funnel, { ...WEB, legend: true }).html!;
    expect(htmlCells(funnelLegend).at(-1)!.map((c) => c.ch).join("")).not.toMatch(/[░▚╱▌═▓▒]/);
    const terminalLegend = renderGlyphChart(energySankey, { target: "terminal" }).build.canvas.grid.char.slice(-80).join("");
    expect(terminalLegend).toMatch(/░ {2}Natural Gas/);
  });
});

describe("B: sub-cell boundaries between solid bands", () => {
  it("energy stacked area, braille 96x32 css: Renewables shows in EVERY column where it is non-zero (the whole-cell rule missed 31 of 90)", () => {
    // Mutation: paint whole cells in the compositor (both halves from the centre sample) or drop the floor -> red.
    const { layout, colors, cols, edge } = energyGeometry(96, 32, "braille");
    const green = colors[2]!;
    const cells = htmlCells(renderGlyphChart(energyArea, WEB).html!);
    // A floored Renewables half lands at the nearest free half: within a quarter row of its own extent here. (Mutation: floor ignores distance -> red.)
    for (let x = layout.plot.x0; x <= layout.plot.x1; x++) for (let y = layout.plot.y0; y <= layout.plot.y1; y++) {
      const c = cells[y]![x]!;
      if (!((c.ch !== " " && c.fg === green) || c.bg === green)) continue;
      const xs = [x - 0.25, x, x + 0.25];
      const lo = Math.min(...xs.map((xx) => edge(3, xx))) - 0.5, hi = Math.max(...xs.map((xx) => edge(2, xx))) - 0.5;
      expect(y + 0.5 >= lo - 0.25 && y - 0.5 <= hi + 0.25, `(${x},${y}) Renewables half at extent [${lo.toFixed(2)}, ${hi.toFixed(2)}]`).toBe(true);
    }
    const texture = htmlCells(renderGlyphChart(energyArea, { ...WEB, regionFill: "texture" }).html!);
    const missing = (grid: Cell[][], has: (c: Cell) => boolean) => {
      const out: number[] = [];
      for (let x = Math.max(layout.plot.x0, cols[0]!); x <= Math.min(layout.plot.x1, cols[cols.length - 1]!); x++) {
        let seen = false;
        for (let y = layout.plot.y0; y <= layout.plot.y1; y++) if (has(grid[y]![x]!)) seen = true;
        if (!seen) out.push(x);
      }
      return out;
    };
    expect(missing(cells, (c) => (c.ch !== " " && c.fg === green) || c.bg === green)).toEqual([]);
    // Not vacuous: the whole-cell paint (texture mode shares its cell rule) loses Renewables' `▚` in many columns.
    expect(missing(texture, (c) => c.ch === "▚").length).toBeGreaterThan(20);
  });

  it("every two-colour cell paints each quadrant in the band that truly owns it, fg as the quadrant glyph's ink over the other band's bg", () => {
    // Mutation: swap fg/bg in `resolveSolidCell` (or invert its mask) -> red.
    const QUAD_MASK = new Map(["▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"].map((g, i) => [g, i + 1]));
    let exact = 0, twoColour = 0;
    for (const [w, h] of [[96, 32], [140, 40]] as const) {
      const { layout, colors, edge } = energyGeometry(w, h, "braille");
      const cells = htmlCells(renderGlyphChart(energyArea, { ...WEB, width: w, height: h }).html!);
      /** The layer whose geometric extent holds row `y` at column `x` (`areaCovers`' own `(top - 0.5, base - 0.5]`), or -1. */
      const owner = (x: number, y: number): number => {
        for (let k = 0; k < SOURCES.length; k++) if (edge(k + 1, x) - 0.5 < y && y <= edge(k, x) - 0.5) return k;
        return -1;
      };
      for (let y = layout.plot.y0; y <= layout.plot.y1; y++) for (let x = layout.plot.x0; x <= layout.plot.x1; x++) {
        const c = cells[y]![x]!;
        if (!c.bg) continue;
        twoColour++;
        const mask = QUAD_MASK.get(c.ch);
        expect(mask, `(${x},${y}) ${c.ch} is a quadrant glyph`).toBeDefined();
        const truth = [[x - 0.25, y - 0.25], [x + 0.25, y - 0.25], [x - 0.25, y + 0.25], [x + 0.25, y + 0.25]].map(([qx, qy]) => owner(qx!, qy!));
        const painted = truth.map((_, q) => ((mask! >> q) & 1 ? c.fg : c.bg));
        // Exact whenever the cell's true content is two bands and no band thinner than half a row sits within
        // the floor's reach (its own extent plus a quarter row, plus this cell's half) — a floored band may take a half here.
        const thin = SOURCES.some((_, k) => {
          const lo = edge(k + 1, x) - 0.5, hi = edge(k, x) - 0.5;
          return hi - lo < 0.5 && hi - lo > 0 && lo <= y + 0.75 && hi >= y - 0.75;
        });
        if (new Set(truth).size === 2 && !truth.includes(-1) && !thin) {
          expect(painted, `(${x},${y}) ${c.ch}`).toEqual(truth.map((k) => colors[k]));
          exact++;
        } else {
          // A floored or three-band cell: both colours still belong to bands present in this cell's column.
          for (const col of [c.fg, c.bg]) {
            const k = colors.indexOf(col!);
            expect(k, `(${x},${y}) ${col}`).toBeGreaterThanOrEqual(0);
            const lo = edge(k + 1, x) - 0.5, hi = edge(k, x) - 0.5;
            expect(lo <= y + 0.75 && hi >= y - 0.75, `(${x},${y}) ${SOURCES[k]} reaches the cell`).toBe(true);
          }
        }
      }
    }
    expect(twoColour).toBeGreaterThan(80);
    expect(exact).toBeGreaterThan(40);
  });

  it("the rounding rule: a boundary within a quarter row of a cell's middle is `▄`; within a quarter row of a cell edge it stays a whole-cell change", () => {
    // Mutation: sample halves at the cell centre instead of the quarter points -> red.
    let middle = 0, edgeCases = 0;
    for (const [w, h] of [[96, 32], [140, 40], [120, 48]] as const) {
    const { layout, colors, edge } = energyGeometry(w, h, "braille");
    const cells = htmlCells(renderGlyphChart(energyArea, { ...WEB, width: w, height: h }).html!);
    for (let x = layout.plot.x0; x <= layout.plot.x1; x++) {
      for (let k = 1; k < SOURCES.length; k++) {
        const g = [x - 0.25, x, x + 0.25].map((xx) => edge(k, xx) - 0.5);
        if (g.some((v) => !Number.isFinite(v))) continue;
        // Layer k-1 sits below stack edge k, layer k above it; a row of each keeps any third band out of the cell.
        const below = edge(k - 1, x) - edge(k, x), above = edge(k, x) - edge(k + 1, x);
        if (below < 1 || above < 1) continue;
        const r = Math.round(g[1]!);
        if (g.every((v) => Math.abs(v - r) < 0.2)) {
          middle++;
          expect(cells[r]![x], `(${x},${r}) straddles ${SOURCES[k - 1]}|${SOURCES[k]}`).toEqual({ ch: "▄", fg: colors[k - 1], bg: colors[k] });
        } else if (g.every((v) => Math.abs(v - (Math.floor(g[1]!) + 0.5)) < 0.2)) {
          edgeCases++;
          const e = Math.floor(g[1]!) + 0.5;
          // A whole solid cell carries its own colour as its background too (Round 26, the seam fix).
          expect(cells[e - 0.5]![x], `(${x},${e - 0.5}) whole ${SOURCES[k]}`).toEqual({ ch: "█", fg: colors[k], bg: colors[k] });
          expect(cells[e + 0.5]![x], `(${x},${e + 0.5}) whole ${SOURCES[k - 1]}`).toEqual({ ch: "█", fg: colors[k - 1], bg: colors[k - 1] });
        }
      }
    }
    }
    expect(middle).toBeGreaterThan(5);
    expect(edgeCases).toBeGreaterThan(5);
  });

  it("Copy ANSI carries the same fg/bg: truecolor cell for cell, ansi256 on the same cells", () => {
    // Mutation: drop the `bg` write in canvas.text -> red.
    const html = htmlCells(renderGlyphChart(energyArea, WEB).html!);
    const ansi = ansiTruecolorCells(renderGlyphChart(energyArea, { ...WEB, color: "truecolor" }).text);
    expect(ansi).toEqual(html);
    const withBg = html.flat().filter((c) => c.bg).length;
    expect(withBg).toBeGreaterThan(40);
    const a256 = renderGlyphChart(energyArea, { ...WEB, color: "ansi256" }).text;
    expect((a256.match(/48;5;\d+/g) ?? []).length).toBeGreaterThan(20);
  });

  it("a solid stacked bar's segment boundaries land on the nearest half cell too, and the bar never floats above its axis", () => {
    const r = renderGlyphChart(stackedBar, { ...WEB, width: 30, height: 14 });
    const cells = htmlCells(r.html!);
    expect(cells.flat().some((c) => c.bg !== null)).toBe(true);
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(stackedBar));
    const marks = resolveGlyphChartSpec(valid);
    const scales = resolveGlyphChartScales(marks, valid.scales);
    const layout = layoutGlyphChart(valid, marks, scales, 30, 14, "auto", [], "braille", resolveGlyphChartLegendOption(valid.legend, undefined), 1);
    // The row right above the axis is fully inked in every bar column: no half-row gap under a bar.
    const above = cells[layout.xAxisLineRow - 1]!;
    const inkCols = above.flatMap((c, x) => (c.ch !== " " && x >= layout.plot.x0 ? [x] : []));
    expect(inkCols.length).toBeGreaterThan(4);
    for (const x of inkCols) expect(above[x]!.ch, `col ${x}`).toBe("█");
  });

  it("a crowd of stack layers each thinner than half a row: every one shows in every column, next to where the data puts it", () => {
    // Mutation: the floor takes the first safe half from the top instead of the nearest -> red.
    const names = ["Base", "T1", "T2", "T3", "T4", "Top"];
    const values = [100, 1, 1, 1, 1, 100];
    const rows = ["2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"].flatMap((d, i) => names.map((s, k) => ({ d, s, v: values[k]! + (k === 0 ? i * 10 : 0) })));
    const crowd: GlyphChartSpec = { marks: [{ ...glyphChartArea(rows, { x: "d", y: "v", fill: "s" }), transform: { kind: "stack" } }] };
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(crowd));
    const marks = resolveGlyphChartSpec(valid);
    const scales = resolveGlyphChartScales(marks, valid.scales);
    const layout = layoutGlyphChart(valid, marks, scales, 60, 24, "auto", [], "braille", resolveGlyphChartLegendOption(valid.legend, undefined), 1);
    const colors = chartSeries(marks).map((s) => resolveSeriesColor(s, true)!);
    const cells = htmlCells(renderGlyphChart(crowd, { ...WEB, width: 60, height: 24 }).html!);
    const x0 = scaleToCol(scales.x, layout.plot, "2020-01-01"), x1 = scaleToCol(scales.x, layout.plot, "2023-01-01");
    for (let x = x0; x <= x1; x++) {
      // The crowd sits between the base's top and the top layer's bottom; each thin layer must show within a row of that band.
      const t = (x - x0) / (x1 - x0);
      const baseTop = scaleToRowExact(scales.y, layout.plot, 100 + 30 * t) - 0.5;
      const crowdTop = scaleToRowExact(scales.y, layout.plot, 104 + 30 * t) - 0.5;
      for (let k = 1; k <= 4; k++) {
        const ys = cells.flatMap((row, y) => (y >= layout.plot.y0 && y <= layout.plot.y1 && ((row[x]!.ch !== " " && row[x]!.fg === colors[k]) || row[x]!.bg === colors[k]) ? [y] : []));
        expect(ys.length, `${names[k]} shows in column ${x}`).toBeGreaterThan(0);
        for (const y of ys) expect(y + 0.5 >= crowdTop - 1 && y - 0.5 <= baseTop + 1, `${names[k]} at (${x},${y}) beside [${crowdTop.toFixed(2)}, ${baseTop.toFixed(2)}]`).toBe(true);
      }
    }
  });

  it("a solid bar meets an interior zero axis on both sides, with no half-row gap above or below it", () => {
    // Mutation: make `zeroRowSnap` the identity -> red (an exact zero row a quarter past a cell edge floats the bar off its axis).
    const mixed: GlyphChartSpec = { marks: [glyphChartBar([{ x: "a", y: -4 }, { x: "b", y: 5 }, { x: "c", y: 3 }, { x: "d", y: -3 }], { x: "x", y: "y" })] };
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(mixed));
    const marks = resolveGlyphChartSpec(valid);
    const scales = resolveGlyphChartScales(marks, valid.scales);
    let checked = 0;
    for (let h = 10; h <= 24; h++) {
      const layout = layoutGlyphChart(valid, marks, scales, 40, h, "auto", [], "braille", resolveGlyphChartLegendOption(valid.legend, undefined), 1);
      const axis = layout.xAxisLineRow;
      expect(axis > layout.plot.y0 && axis < layout.plot.y1, `h=${h}: the axis is interior`).toBe(true);
      const cells = htmlCells(renderGlyphChart(mixed, { ...WEB, width: 40, height: h }).html!);
      for (let x = layout.plot.x0; x <= layout.plot.x1; x++) for (const y of [axis - 1, axis + 1]) {
        const c = cells[y]![x]!;
        if (!QUADRANTS.has(c.ch)) continue;
        expect(c.ch, `h=${h} (${x},${y}) touches the axis`).toBe("█");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("only straddling cells change: every solid cell outside a boundary is the whole-cell paint's own cell (box/ascii untouched)", () => {
    // Mutation: always write a `bg` (the upper neighbour's colour) on a whole cell -> red.
    const specs = [...goodSpecs, energyArea, stackedBar].filter((s) => s.marks.every((m) => m.type !== "cell" && m.type !== "sankey" && m.type !== "funnel"));
    let changed = 0;
    for (const spec of specs) for (const charset of ["box", "blocks", "braille"] as const) for (const [w, h] of [[60, 24], [96, 32]] as const) {
      // `regionFill: "auto"` explicit — this test wants the specs auto still resolves solid for; the library's own default is "texture".
      const opts: GlyphChartRenderOptions = { width: w, height: h, charset, color: "css", regionFill: "auto" };
      if (glyphChartRegionFill(spec, opts).fill !== "solid") continue;
      const solid = htmlCells(renderGlyphChart(spec, opts).html!);
      const whole = htmlCells(renderGlyphChart(spec, { ...opts, regionFill: "texture" }).html!)
        .map((row) => row.map((c) => (/[░▚╱▌═▓▒]/.test(c.ch) ? { ...c, ch: "█" } : c)));
      for (let y = 0; y < solid.length; y++) for (let x = 0; x < solid[y]!.length; x++) {
        // A solid `█` carrying its own colour as `bg` is the whole-cell paint's `█` (Round 26, the seam fix).
        const s = solid[y]![x]!;
        const a = whole[y]![x]!, b = s.ch === "█" && s.bg === s.fg ? { ...s, bg: null } : s;
        if (a.ch === b.ch && a.fg === b.fg && a.bg === b.bg) continue;
        changed++;
        const key = `${spec.title ?? spec.marks[0]!.type}:${charset}:${w}x${h} (${x},${y}) ${a.ch}->${b.ch}`;
        expect(charset, key).not.toBe("box");
        expect(b.bg !== null || (QUADRANTS.has(b.ch) && b.ch !== "█") || (QUADRANTS.has(a.ch) && a.ch !== "█"), key).toBe(true);
      }
    }
    expect(changed).toBeGreaterThan(100);
  });
});

describe("Round 27: under solid, a write owns its whole cell, and a half-cell edge keeps the region it lies over", () => {
  /** A canvas painted exactly as `renderGlyphChart`'s solid exit is, so its `bg` reads at any `textScale`. */
  function solidCanvas(spec: GlyphChartSpec, charset: GlyphChartCharset, w: number, h: number, textScale: number) {
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(spec));
    const marks = resolveGlyphChartSpec(valid);
    const scales = resolveGlyphChartScales(marks, valid.scales);
    const layout = layoutGlyphChart(valid, marks, scales, w, h, "auto", [], charset, resolveGlyphChartLegendOption(valid.legend, undefined), textScale);
    const canvas = createGlyphCanvas({ cols: w, rows: h, tier: charset });
    paintGlyphChart(canvas, valid, marks, scales, layout, { colorEnabled: true, regionFill: "solid", textScale }, []);
    return canvas;
  }
  const YEARS4 = ["2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"];
  /** The review's repro: a one-unit band on top of a hundred-unit one, under a corner legend. */
  const thinUnderLegend = (placement: "top-left" | "top-right" | "bottom-left" | "bottom-right"): GlyphChartSpec => ({
    marks: [{ ...glyphChartArea(YEARS4.flatMap((d) => [{ d, s: "Big", v: 100 }, { d, s: "Small", v: 1 }]), { x: "d", y: "v", fill: "s" }), transform: { kind: "stack" } }],
    legend: { placement },
  });
  const tall = glyphChartBar([{ x: "a", y: 6.3 }, { x: "b", y: 4.2 }, { x: "c", y: 2.7 }], { x: "x", y: "y" }, { name: "Tall" });
  const short = glyphChartBar([{ x: "a", y: 3.6 }, { x: "b", y: 5.4 }, { x: "c", y: 2.2 }], { x: "x", y: "y" }, { name: "Short" });
  const overlays: GlyphChartSpec[] = [
    { marks: [tall, short] },
    { marks: [...stackedBar.marks, glyphChartRect([{ x: "a", y: 5 }, { x: "b", y: 3 }], { x: "x", y: "y" }, { name: "Over" })] },
    // A line along the fossil band's own top edge: every cell it crosses is a two-colour boundary cell.
    { marks: [...energyArea.marks, glyphChartLine(energyRows.filter((r) => r.source === "Fossil fuels"), { x: "year", y: "twh" }, { name: "Fossil edge" })] },
  ];

  it("no background outlives its glyph: every `█` carries its own ink, and only a two-colour quadrant cell carries another colour", () => {
    // Mutations: drop `solidOwnedCanvas` -> red (the review's blue `█` swatch over orange, and the legend's letters);
    // drop the canvas's filler bg write -> red at textScale 2 (a scaled legend name's blanked cells keep the band's colour);
    // drop the canvas's line bg writes -> red (the fossil-edge line's braille cells keep the band below's colour).
    const specs = [...goodSpecs, energyArea, stackedBar, energySankey, funnel, ...(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(thinUnderLegend), ...overlays];
    let twoColour = 0, blocks = 0;
    for (const spec of specs) for (const charset of ["box", "blocks", "braille"] as const) for (const [w, h, s] of [[60, 24, 1], [96, 32, 1], [120, 48, 2]] as const) {
      // `regionFill: "auto"` explicit — only specs auto still resolves solid for; the library's own default is "texture".
      if (glyphChartRegionFill(spec, { width: w, height: h, charset, color: "css", regionFill: "auto" }).fill !== "solid") continue;
      const canvas = solidCanvas(spec, charset, w, h, s);
      const { char, color } = canvas.grid;
      for (let idx = 0; idx < char.length; idx++) {
        const key = `${spec.title ?? spec.marks.map((m) => m.type).join("+")}:${charset}:${w}x${h} (${idx % w},${Math.floor(idx / w)}) ${char[idx]}`;
        if (char[idx] === "█" && color[idx]) { expect(canvas.bg[idx], key).toBe(color[idx]); blocks++; }
        else if (canvas.bg[idx] !== null) { expect(QUADRANTS.has(char[idx]!), key).toBe(true); twoColour++; }
      }
    }
    expect(blocks).toBeGreaterThan(1000);
    expect(twoColour).toBeGreaterThan(100);
  }, 60_000);

  it("overlapping bar marks: every quadrant inside a bar's extent shows the latest bar covering it, never page background", () => {
    // Mutation: `solidRegionBeneath` answers `null` -> red (a later bar's half-cell top punched through the earlier bar).
    const spec: GlyphChartSpec = { marks: [tall, short] };
    const valid = validateGlyphChartSpec(normalizeGlyphChartInput(spec));
    const marks = resolveGlyphChartSpec(valid);
    const scales = resolveGlyphChartScales(marks, valid.scales);
    const colors = chartSeries(marks).map((s) => resolveSeriesColor(s, true)!);
    const values = marks.map((m) => new Map(m.rows.map((r) => [String(r.x), Number(r.y)])));
    const QUAD_MASK = new Map(["▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"].map((g, i) => [g, i + 1]));
    let checked = 0, kept = 0;
    for (let h = 10; h <= 24; h++) {
      const layout = layoutGlyphChart(valid, marks, scales, 30, h, "auto", [], "braille", resolveGlyphChartLegendOption(valid.legend, false), 1);
      const cells = htmlCells(renderGlyphChart(spec, { ...WEB, width: 30, height: h, legend: false }).html!);
      const zeroExact = scaleToRowExact(scales.y, layout.plot, 0);
      const base = Math.abs(zeroExact - Math.round(zeroExact)) < 1e-9 ? Math.round(zeroExact) : zeroExact;
      for (const v of ["a", "b", "c"]) {
        const [c0, c1] = bandColRange(scales.x, layout.plot, v)!;
        const tops = values.map((m) => scaleToRowExact(scales.y, layout.plot, m.get(v)!));
        for (let x = c0; x <= c1; x++) for (let y = layout.plot.y0; y <= layout.plot.y1; y++) {
          if (y === layout.xAxisLineRow) continue;
          const c = cells[y]![x]!;
          const mask = QUAD_MASK.get(c.ch) ?? 0;
          for (let q = 0; q < 4; q++) {
            const qy = y + (q < 2 ? -0.25 : 0.25);
            const covering = [1, 0].find((k) => tops[k]! - 0.5 < qy && qy <= base - 0.5);
            if (covering === undefined) continue;
            const painted = mask & (1 << q) ? c.fg : c.bg;
            expect(painted, `h=${h} (${x},${y}) ${c.ch} q${q}`).toBe(colors[covering]);
            checked++;
            if (covering === 0 && c.fg === colors[1]) kept++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // Not vacuous: the earlier bar shows through a later bar's half-cell edge in many quadrants.
    expect(kept).toBeGreaterThan(20);
  });

  it("a zero-valued stack layer paints nothing: [100, 0, 100] keeps the middle series off the plot, [100, 1, 100] shows it", () => {
    // Mutation: drop the floor's zero-span guard (`span[0] === span[1]` in `paintSolidRegions`) -> red (it floored the empty layer into view).
    for (const middle of [0, 1]) {
      const rows = YEARS4.flatMap((d, i) => [{ d, s: "Base", v: 100 + 10 * i }, { d, s: "Middle", v: middle }, { d, s: "Top", v: 100 }]);
      const area: GlyphChartSpec = { marks: [{ ...glyphChartArea(rows, { x: "d", y: "v", fill: "s" }), transform: { kind: "stack" } }] };
      const bar: GlyphChartSpec = { marks: [{ ...glyphChartBar(rows, { x: "d", y: "v", fill: "s" }), transform: { kind: "stack" } }] };
      for (const spec of [area, bar]) {
        const color = chartSeries(resolveGlyphChartSpec(validateGlyphChartSpec(normalizeGlyphChartInput(spec))))[1]!;
        const middleColor = resolveSeriesColor(color, true);
        for (const charset of ["blocks", "braille"] as const) for (const [w, h] of [[60, 24], [96, 32]] as const) {
          const cells = htmlCells(renderGlyphChart(spec, { ...WEB, charset, width: w, height: h, legend: false }).html!).flat();
          const shown = cells.filter((c) => (c.ch !== " " && c.fg === middleColor) || c.bg === middleColor).length;
          const key = `${spec.marks[0]!.type} middle=${middle} ${charset} ${w}x${h}`;
          if (middle === 0) expect(shown, key).toBe(0);
          else expect(shown, key).toBeGreaterThan(spec === area ? 20 : 0);
        }
      }
    }
  });
});

// The fixture is b662a509's hashes with ONE documented exception: the 112 energySankey entries (14 exits x 4
// charsets x 2 sizes) were re-pinned at d9bd096c, whose skip-level gate re-places Industrial below Electricity
// Generation (Round 26). Regenerated against b662a509 in Round 27, every other entry matches it exactly and every
// energySankey entry differs, so a change to any other spec's texture exits still reddens here.
describe("texture output is byte-identical to b662a509, the energy sankey's re-placed order excepted (fixtures/solidSubcellParentFixtures.json)", () => {
  const parent: Record<string, string> = JSON.parse(readFileSync(fixturePath("fixtures/solidSubcellParentFixtures.json"), "utf8"));
  const specs: [string, GlyphChartSpec][] = [...goodSpecs.map((s, i) => [`g${i}`, s] as [string, GlyphChartSpec]), ["energyArea", energyArea], ["stackedBar", stackedBar], ["energySankey", energySankey], ["funnel", funnel]];

  it.each(specs.map(([id, spec]) => ({ id, spec })))("$id: every texture exit on every charset at 60x24 and 96x32", ({ id, spec }) => {
    // Mutation: paint a solid ribbon on the texture canvas (or write `bg` there) -> red.
    let checked = 0;
    for (const charset of CHARSETS) for (const [w, h] of [[60, 24], [96, 32]] as const) {
      const base: GlyphChartRenderOptions = { width: w, height: h, charset };
      const k = `${id}:${charset}:${w}x${h}`;
      const expectHash = (key: string, value: string) => { expect(hash(value), key).toBe(parent[key]); checked++; };
      const none = renderGlyphChart(spec, { ...base, color: "none" });
      expectHash(`${k}:none:text`, none.text);
      expectHash(`${k}:none:grid`, none.build.canvas.grid.char.join(""));
      const css = renderGlyphChart(spec, { ...base, color: "css", regionFill: "texture" });
      expectHash(`${k}:css:texture:html`, css.html!);
      expectHash(`${k}:css:texture:text`, css.text);
      expectHash(`${k}:css:texture:grid`, css.build.canvas.grid.char.join(""));
      const auto = renderGlyphChart(spec, { ...base, color: "css" });
      expectHash(`${k}:css:auto:text`, auto.text);
      expectHash(`${k}:css:auto:grid`, auto.build.canvas.grid.char.join(""));
      for (const color of ["truecolor", "ansi256", "ansi16"] as const) expectHash(`${k}:${color}:texture:text`, renderGlyphChart(spec, { ...base, color, regionFill: "texture" }).text);
      expectHash(`${k}:terminal:text`, renderGlyphChart(spec, { ...base, target: "terminal" }).text);
      expectHash(`${k}:nocolor:text`, renderGlyphChart(spec, { ...base, color: "truecolor", env: { NO_COLOR: "1" } }).text);
      expectHash(`${k}:none:ts2:html`, renderGlyphChart(spec, { width: w * 2, height: h * 2, charset, color: "none", textScale: 2 }).html!);
      expectHash(`${k}:ansi256:texture:ts2:html`, renderGlyphChart(spec, { width: w * 2, height: h * 2, charset, color: "ansi256", regionFill: "texture", textScale: 2 }).html!);
    }
    expect(checked).toBe(4 * 2 * 14);
  }, 60_000);
});
