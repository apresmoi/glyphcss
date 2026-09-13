/**
 * CHARTS-RESEARCH `DIAGNOSIS-solid-colour-fills.md`: a region mark's fill is
 * SOLID where colour already tells its series apart, and textured everywhere
 * else. One resolver decides (`regionFill.ts`), per whole chart, and only the
 * colour-carrying exits read the solid paint.
 *
 * Mutation checks run against this file are recorded in the diagnosis's own
 * "After" section, each against the test it reddened.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENERGY_FLOW_SANKEY_DATA } from "./flowMarksData";
import { glyphChartRegionFill, renderGlyphChart } from "./render";
import { goodSpecs } from "./reviewFixtures";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartSankey } from "./spec";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartRenderOptions, GlyphChartSpec } from "./types";

const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
/** Every non-solid glyph `seriesShade` can hand a region fill on box/blocks/braille. */
const TEXTURE_GLYPHS = ["░", "▚", "╱", "▌", "═", "▓", "▒"];
/** The blocks quadrant table (`fillSubGlyph`): a solid fill's boundary cells on braille/blocks. */
const QUADRANT_GLYPHS = ["▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];
/** The subset no sub-cell silhouette quadrant (`fillSubGlyph`) can also be. */
const PURE_TEXTURE_GLYPHS = ["░", "╱", "═", "▓", "▒"];

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
/** The `/charts` "World primary energy consumption by source" dataset, as its curated mapping renders it. */
const energyRows = Object.entries(YEARS).flatMap(([year, s]) => Object.entries(s).map(([source, twh]) => ({ year: `${year}-01-01`, source, twh })));
const energy: GlyphChartSpec = { marks: [{ ...glyphChartArea(energyRows, { x: "year", y: "twh", fill: "source" }), transform: { kind: "stack" } }], title: "World primary energy consumption by source" };
const stackedBar: GlyphChartSpec = { marks: [{ ...glyphChartBar([{ x: "a", y: 3, s: "P" }, { x: "a", y: 2, s: "Q" }, { x: "a", y: 4, s: "R" }, { x: "b", y: 4, s: "P" }, { x: "b", y: 1, s: "Q" }, { x: "b", y: 2, s: "R" }], { x: "x", y: "y", fill: "s" }), transform: { kind: "stack" } }] };
const shares = [{ s: "Coal", v: 35 }, { s: "Gas", v: 23 }, { s: "Hydro", v: 15 }, { s: "Nuclear", v: 9 }, { s: "Wind", v: 8 }];
const pie: GlyphChartSpec = { marks: [glyphChartArc(shares, { fill: "s", y: "v" })] };
/** Two series one ANSI256 slot apart: distinct as hex, identical once quantised to 256 colours. */
const nearReds: GlyphChartSpec = { marks: [{ ...glyphChartArc([{ s: "A", v: 1 }, { s: "B", v: 2 }], { fill: "s", y: "v" }), options: { color: ["#ff0000", "#ff0100"] } }] };
const donut: GlyphChartSpec ={ marks: [glyphChartArc(shares, { fill: "s", y: "v" }, { innerRadius: 0.5 })] };

function htmlRows(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return text.split("\n").map((row) => [...row].join(""));
}
function gridRows(r: { grid: { cols: number; rows: number; char: readonly string[] } }): string[] {
  return Array.from({ length: r.grid.rows }, (_, y) => r.grid.char.slice(y * r.grid.cols, (y + 1) * r.grid.cols).join(""));
}
const count = (rows: readonly string[], glyph: string): number => rows.reduce((n, row) => n + [...row].filter((c) => c === glyph).length, 0);
/** The glyph three cells before a legend name (`swatchGutter` is 3), searched bottom-up so a pie's callout of the same name is never read. */
function swatchBefore(rows: readonly string[], name: string): string | undefined {
  for (const row of [...rows].reverse()) {
    const chars = [...row];
    const at = row.indexOf(name);
    if (at >= 3 && chars[[...row.slice(0, at)].length - 3] !== " ") return chars[[...row.slice(0, at)].length - 3];
  }
  return undefined;
}

describe("auto resolution — solid only where colour carries identity", () => {
  it("web + css + the default palette resolves solid for a stacked area, a stacked bar, a pie and a donut", () => {
    // Mutation: return texture from the final `colors-distinct` branch -> red.
    for (const spec of [energy, stackedBar, pie, donut]) {
      expect(glyphChartRegionFill(spec, { target: "web", color: "css" })).toMatchObject({ fill: "solid", reason: "colors-distinct" });
    }
    expect(glyphChartRegionFill(energy)).toMatchObject({ fill: "solid" }); // the bare call is web/css
  });

  it("terminal + truecolor keeps textures (a terminal copy or theme loses colour)", () => {
    // Mutation: drop the `target === "terminal"` clause -> red.
    expect(glyphChartRegionFill(energy, { target: "terminal", color: "truecolor" })).toMatchObject({ fill: "texture", reason: "target-terminal" });
    expect(glyphChartRegionFill(pie, { target: "terminal" })).toMatchObject({ fill: "texture", reason: "target-terminal" });
  });

  it("chat keeps textures even when handed a colour mode", () => {
    expect(glyphChartRegionFill(energy, { target: "chat", color: "css" })).toMatchObject({ fill: "texture", reason: "target-chat" });
    expect(glyphChartRegionFill(energy, { target: "chat" })).toMatchObject({ fill: "texture", reason: "color-off" });
  });

  it("web + css + ONE hex for every series keeps textures (single colour)", () => {
    // Mutation: skip the collision loop -> red.
    const single = { ...energy, marks: [{ ...energy.marks[0]!, options: { color: "#ff0000" } }] };
    const res = glyphChartRegionFill(single, { color: "css" });
    expect(res).toMatchObject({ fill: "texture", reason: "colors-collide", colliding: ["Fossil fuels", "Nuclear"] });
    expect(res.message).toMatch(/same colour/);
  });

  it("web + ansi16 keeps textures when two palette entries quantise to one SGR colour, and ansi256 does not collide", () => {
    // Mutation: compare the raw hex instead of `nearestAnsiCanvasColor` -> red (blue #3b82f6 and green #22c55e both map to #008080).
    expect(glyphChartRegionFill(energy, { color: "ansi16" })).toMatchObject({ fill: "texture", reason: "colors-collide", colliding: ["Fossil fuels", "Renewables"] });
    expect(glyphChartRegionFill(stackedBar, { color: "ansi16" })).toMatchObject({ fill: "texture", reason: "colors-collide" });
    expect(glyphChartRegionFill(energy, { color: "ansi256" })).toMatchObject({ fill: "solid" });
    // Two series share no SGR colour on ansi16 (blue -> teal, orange -> olive): the threshold is 2.
    const twoSeries = { marks: [glyphChartArc([{ s: "A", v: 1 }, { s: "B", v: 2 }], { fill: "s", y: "v" })] };
    expect(glyphChartRegionFill(twoSeries, { color: "ansi16" })).toMatchObject({ fill: "solid" });
  });

  it("ansi256 collision protection: two hexes one SGR slot apart resolve texture under auto, naming both series", () => {
    // Mutation: drop the ansi256 branch of `displayColor` (compare raw hex at 256 colours) -> red.
    expect(glyphChartRegionFill(nearReds, { color: "css" })).toMatchObject({ fill: "solid" });
    const auto = glyphChartRegionFill(nearReds, { color: "ansi256" });
    expect(auto).toMatchObject({ fill: "texture", reason: "colors-collide", colliding: ["A", "B"] });
    expect(auto.message).toMatch(/"A" and "B" paint the same colour in ansi256/);
  });

  it("ansi256 collision protection: an explicit solid is refused with `region-fill-solid-refused` and falls back to textures", () => {
    // Mutation: drop the ansi256 branch of `displayColor` -> red.
    const refused = renderGlyphChart(nearReds, { color: "ansi256", regionFill: "solid", charset: "box" });
    expect(refused.report.ledger).toContainEqual(expect.objectContaining({ code: "region-fill-solid-refused", detail: expect.objectContaining({ reason: "colors-collide", colliding: ["A", "B"] }) }));
    // It fell back to textures: B's `░` is in the ANSI exit, not a second `█`.
    expect(refused.text.replace(/\x1b\[[0-9;]*m/g, "")).toContain("░");
  });

  it("a series name shared across marks is ONE identity: it never collides with itself", () => {
    // Mutation: drop the repeated-name skip in the collision loop -> red ("Revenue" and "Revenue" paint the same colour).
    const revenue: GlyphChartSpec = { marks: [
      glyphChartBar([{ x: "a", y: 3 }, { x: "b", y: 4 }], { x: "x", y: "y" }, { name: "Revenue" }),
      glyphChartBar([{ x: "c", y: 2 }, { x: "d", y: 5 }], { x: "x", y: "y" }, { name: "Revenue" }),
    ] };
    expect(glyphChartRegionFill(revenue, { color: "css" })).toMatchObject({ fill: "solid", reason: "colors-distinct" });
  });

  it("the solid paint's ledger is discarded: a solid render reports exactly the textured render's ledger, never an entry twice", () => {
    // Mutation: hand the solid paint the real ledger in `renderGlyphChart` -> red (every paint-time entry is reported twice).
    const zeroSlice: GlyphChartSpec = { marks: [glyphChartArc([{ s: "A", v: 3 }, { s: "B", v: 0 }, { s: "C", v: 2 }], { fill: "s", y: "v" })] };
    const sankey: GlyphChartSpec = { marks: [glyphChartSankey(ENERGY_FLOW_SANKEY_DATA, { source: "from", target: "to", value: "amount" })] };
    for (const [spec, opts] of [[zeroSlice, {}], [sankey, { width: 40, height: 20 }], [energy, {}]] as const) {
      const base: GlyphChartRenderOptions = { color: "css", ...opts };
      expect(glyphChartRegionFill(spec, base).fill).toBe("solid");
      const solid = renderGlyphChart(spec, base).report.ledger;
      const texture = renderGlyphChart(spec, { ...base, regionFill: "texture" }).report.ledger;
      expect(solid).toEqual(texture);
      expect(new Set(solid.map((e) => JSON.stringify(e))).size).toBe(solid.length);
    }
    expect(renderGlyphChart(zeroSlice, { color: "css" }).report.ledger.map((e) => e.code)).toContain("slice-dropped");
    expect(renderGlyphChart(sankey, { color: "css", width: 40, height: 20 }).report.ledger.length).toBeGreaterThan(0);
  });

  it("the default palette separates 8 pie slices; a 9th repeats blue and falls back to textures", () => {
    const slices = (n: number) => ({ marks: [glyphChartArc(Array.from({ length: n }, (_, i) => ({ s: `S${i}`, v: 1 })), { fill: "s", y: "v" })] });
    expect(glyphChartRegionFill(slices(8), { color: "css" }).fill).toBe("solid");
    expect(glyphChartRegionFill(slices(9), { color: "css" })).toMatchObject({ fill: "texture", reason: "colors-collide", colliding: ["S0", "S8"] });
  });

  it("colour off, NO_COLOR and a chart with no region mark resolve texture; a flow mark no longer forces it", () => {
    expect(glyphChartRegionFill(energy, { color: "none" }).reason).toBe("color-off");
    expect(glyphChartRegionFill(energy, { color: "truecolor", env: { NO_COLOR: "1" } }).reason).toBe("color-off");
    expect(glyphChartRegionFill(energy, { color: "truecolor", env: { NO_COLOR: "1", FORCE_COLOR: "1" } }).fill).toBe("solid");
    const withSankey = { marks: [...stackedBar.marks, glyphChartSankey([{ a: "X", b: "Y", v: 1 }], { source: "a", target: "b", value: "v" })] };
    // Sankey ribbons follow the rule like every other region mark (solidSubcell.test.ts).
    expect(glyphChartRegionFill(withSankey, { color: "css" })).toMatchObject({ fill: "solid", reason: "colors-distinct" });
    expect(glyphChartRegionFill({ marks: [goodSpecs[0]!.marks[0]!] }, { color: "css" }).reason).toBe("no-region-mark");
  });

  it("an explicit `texture` keeps textures on web css; an explicit `solid` overrides the target guess but not the honesty rules", () => {
    expect(glyphChartRegionFill(energy, { regionFill: "texture" })).toMatchObject({ fill: "texture", reason: "requested-texture" });
    expect(glyphChartRegionFill(energy, { target: "terminal", regionFill: "solid" }).fill).toBe("solid");
    const refused = renderGlyphChart(energy, { color: "none", regionFill: "solid" });
    expect(refused.report.ledger).toContainEqual(expect.objectContaining({ code: "region-fill-solid-refused", detail: { reason: "color-off" } }));
    const collide = renderGlyphChart(energy, { color: "ansi16", regionFill: "solid" });
    expect(collide.report.ledger).toContainEqual(expect.objectContaining({ code: "region-fill-solid-refused", detail: { reason: "colors-collide", colliding: ["Fossil fuels", "Renewables"] } }));
    // `auto` never logs — a texture it chose is not a refusal.
    expect(renderGlyphChart(energy, { color: "none" }).report.ledger.map((e) => e.code)).not.toContain("region-fill-solid-refused");
  });

  it("rejects an unknown value with the tagged rule", () => {
    expect(() => renderGlyphChart(energy, { regionFill: "stripes" as never })).toThrow(expect.objectContaining({ code: "bad-region-fill" }));
    expect(() => glyphChartRegionFill(energy, { regionFill: "stripes" as never })).toThrow(expect.objectContaining({ code: "bad-region-fill" }));
  });
});

describe("the solid paint", () => {
  it("box: a coloured stacked area, stacked bar, pie and donut paint only `█` where textures were, legend swatches included", () => {
    // Mutation: make `regionFillGlyph` ignore `fill` -> red (every texture glyph survives).
    for (const spec of [energy, stackedBar, pie, donut]) {
      const rows = htmlRows(renderGlyphChart(spec, { charset: "box", color: "css" }).html!);
      for (const glyph of TEXTURE_GLYPHS) expect(count(rows, glyph), `${glyph} in ${JSON.stringify(spec.marks[0]!.type)}`).toBe(0);
      expect(count(rows, "█")).toBeGreaterThan(0);
    }
  });

  it("braille: the stacked area's bands are solid, their boundaries in quadrant blocks (the half-cell rule is solidSubcell.test.ts')", () => {
    const colour = renderGlyphChart(energy, { color: "css" });
    const solid = htmlRows(colour.html!);
    const texture = gridRows(colour);
    for (const glyph of PURE_TEXTURE_GLYPHS) expect(count(solid, glyph)).toBe(0);
    expect(count(texture, "╱")).toBeGreaterThan(0);
    let changed = 0;
    for (let y = 0; y < texture.length; y++) {
      const a = [...texture[y]!], b = [...solid[y]!];
      for (let x = 0; x < a.length; x++) {
        if (a[x] === b[x]) continue;
        changed++;
        expect(QUADRANT_GLYPHS, `row ${y} col ${x}: ${a[x]} became ${b[x]}`).toContain(b[x]);
        expect([...TEXTURE_GLYPHS, ...QUADRANT_GLYPHS], `row ${y} col ${x} was ${a[x]}`).toContain(a[x]);
      }
    }
    expect(changed).toBeGreaterThan(200);
    // Every half-cell edge the texture paint drew survives; boundaries between bands add more.
    expect(count(solid, "▄")).toBeGreaterThanOrEqual(count(texture, "▄"));
  });

  it("ascii solid is `#`, 7-bit", () => {
    const rows = htmlRows(renderGlyphChart(stackedBar, { charset: "ascii", color: "css" }).html!);
    for (const glyph of [".", "@"]) expect(rows.slice(0, -2).join("").includes(glyph)).toBe(false);
    expect([...rows.join("")].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it("the legend swatch equals the fill: `█` when solid, the series' own texture otherwise, bottom and corner legends alike", () => {
    // Mutation: leave either legend branch on `seriesShade` -> red.
    for (const legend of [true, { placement: "top-left" as const }]) {
      const spec = { ...energy, legend };
      const solid = renderGlyphChart(spec, { charset: "box", color: "css" });
      const solidRows = htmlRows(solid.html!);
      const textureRows = gridRows(solid);
      for (const name of SOURCES) expect(swatchBefore(solidRows, name), `${name} solid swatch`).toBe("█");
      expect(SOURCES.map((name) => swatchBefore(textureRows, name))).toEqual(["█", "░", "▚", "╱"]);
    }
    const pieRows = htmlRows(renderGlyphChart(pie, { charset: "box", color: "css" }).html!);
    for (const { s } of shares) expect(swatchBefore(pieRows, s), `${s} pie swatch`).toBe("█");
    // Callouts are untouched by the fill.
    expect(pieRows.join("\n")).toMatch(/Coal · 39%/);
    expect(pieRows.join("\n")).toBe(pieRows.join("\n").replace(/[░▚╱▌═▓▒]/g, ""));
  });

  it("Copy ANSI (`text` under an ANSI mode on the web) carries solid colour; the ANSI html at textScale 2 does too", () => {
    const ansi = renderGlyphChart(energy, { color: "ansi256" });
    const stripped = ansi.text.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    for (const glyph of PURE_TEXTURE_GLYPHS) expect(count(stripped, glyph)).toBe(0);
    const dense = renderGlyphChart(energy, { color: "ansi256", width: 192, height: 64, textScale: 2 });
    for (const glyph of PURE_TEXTURE_GLYPHS) expect(count(htmlRows(dense.html!), glyph)).toBe(0);
  });
});

describe("plain exits keep textures", () => {
  it("a coloured css chart's plain `text` and `grid` still carry every series' texture", () => {
    // Mutation: encode `text`/`grid` from the solid canvas -> red.
    const r = renderGlyphChart(energy, { color: "css" });
    for (const glyph of ["░", "▚", "╱"]) {
      expect(r.text.includes(glyph), `text has ${glyph}`).toBe(true);
      expect(r.grid.char.includes(glyph), `grid has ${glyph}`).toBe(true);
    }
  });
});

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);

describe("byte-identity against the commit before regionFill existed (reviewFixtures exception 10)", () => {
  const parent: Record<string, string> = JSON.parse(readFileSync(fixturePath("fixtures/regionFillParentFixtures.json"), "utf8"));

  it.each(goodSpecs.map((spec, i) => ({ spec, i })))("goodSpecs[$i]: colour-off, grid, plain text, NO_COLOR and terminal exits are byte-identical on every charset", ({ spec, i }) => {
    // Mutation: paint `canvas` (not the second canvas) with `regionFill: "solid"` -> red on every multi-series region spec.
    for (const charset of CHARSETS) {
      const base: GlyphChartRenderOptions = { width: 60, height: 24, charset };
      const none = renderGlyphChart(spec, { ...base, color: "none" });
      expect(hash(none.text), `${i}:${charset}:none:text`).toBe(parent[`${i}:${charset}:none:text`]);
      expect(hash(none.grid.char.join("")), `${i}:${charset}:none:grid`).toBe(parent[`${i}:${charset}:none:grid`]);
      const css = renderGlyphChart(spec, { ...base, color: "css" });
      expect(hash(css.text), `${i}:${charset}:css:text`).toBe(parent[`${i}:${charset}:css:text`]);
      expect(hash(css.grid.char.join("")), `${i}:${charset}:css:grid`).toBe(parent[`${i}:${charset}:css:grid`]);
      for (const color of ["truecolor", "ansi256", "ansi16"] as const) {
        expect(hash(renderGlyphChart(spec, { ...base, color }).grid.char.join("")), `${i}:${charset}:${color}:grid`).toBe(parent[`${i}:${charset}:${color}:grid`]);
      }
      expect(hash(renderGlyphChart(spec, { ...base, color: "truecolor", env: { NO_COLOR: "1" } }).text), `${i}:${charset}:nocolor:text`).toBe(parent[`${i}:${charset}:nocolor:text`]);
      expect(hash(renderGlyphChart(spec, { ...base, target: "terminal" }).text), `${i}:${charset}:terminal:text`).toBe(parent[`${i}:${charset}:terminal:text`]);
    }
  });

  it.each(goodSpecs.map((spec, i) => ({ spec, i })))("goodSpecs[$i]: every colour-carrying exit is byte-identical under textures, and changes only where the resolver says solid", ({ spec, i }) => {
    for (const charset of CHARSETS) {
      const base: GlyphChartRenderOptions = { width: 60, height: 24, charset };
      const exits: readonly [GlyphChartColorMode, "html" | "text"][] = [["css", "html"], ["truecolor", "text"], ["ansi256", "text"], ["ansi16", "text"]];
      for (const [color, exit] of exits) {
        const key = `${i}:${charset}:${color}:${exit}`;
        expect(hash(renderGlyphChart(spec, { ...base, color, regionFill: "texture" })[exit]!), `${key} texture`).toBe(parent[key]);
        const auto = renderGlyphChart(spec, { ...base, color })[exit]!;
        if (glyphChartRegionFill(spec, { ...base, color }).fill === "texture") expect(hash(auto), `${key} auto`).toBe(parent[key]);
      }
    }
  });

  it("a multi-series coloured chart really does change (the exception is not vacuous)", () => {
    const i = goodSpecs.findIndex((s) => s.marks[0]!.type === "arc" && s.marks[0]!.data.length === 3 && typeof s.marks[0]!.channels.fill === "string");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(hash(renderGlyphChart(goodSpecs[i]!, { width: 60, height: 24, charset: "box", color: "css" }).html!)).not.toBe(parent[`${i}:box:css:html`]);
  });
});
