import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlyphMapSource } from "./loadSource";
import { glyphMapBounds } from "../view";
import { sampleGlyphMapField } from "../sample";
import { classifyGlyphMapField } from "../classify";
import { GlyphMapClassifiers } from "../classify";
import { compileGlyphMap } from "../compile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../fixtures/sample-region.asc");
const GOLDEN_HTML = path.resolve(__dirname, "../../fixtures/sample-region.golden.html");
const GOLDEN_CSS = path.resolve(__dirname, "../../fixtures/sample-region.golden.css");

const PRESENTATION = {
  ramp: " .:-=+*#%@",
  colors: ["#2a55a8", "#3a6b30", "#5a7a30", "#8a7050", "#a89070", "#c0a080", "#d0b090", "#e0c0a0", "#f0e0d0", "#ffffff"],
  water: "~",
} as const;

async function bake() {
  const source = await loadGlyphMapSource({ path: FIXTURE, id: "sample-region-fixture-v1" });
  const view = glyphMapBounds({
    west: source.bounds.west,
    east: source.bounds.east,
    south: source.bounds.south,
    north: source.bounds.north,
    cols: 30,
    rows: 20,
  });
  const field = await sampleGlyphMapField(source, view, { sampler: "max" });
  const bands = classifyGlyphMapField(field, GlyphMapClassifiers.etopo1V1);
  return compileGlyphMap(bands, PRESENTATION);
}

/**
 * Acceptance gate 1: a small vendored public-domain sample region re-bakes
 * byte-identical, from a pure-JS-readable source, with no `gdal-async`
 * anywhere in this package's dependency graph (MAPS.md §10, §13).
 *
 * `fixtures/sample-region.asc` is a synthetic terrain (a basin ringed by a
 * ridge, with a small noData patch), authored for this test — not real-world
 * survey data, so it is unambiguously public domain (CC0) and safe to vendor
 * at a few KB. It exercises the same ASCII Grid → sample → classify →
 * compile pipeline a real ETOPO1 region would.
 */
describe("determinism (acceptance gate 1)", () => {
  it("re-bakes byte-identical to a checked-in golden artifact", async () => {
    const { html, css } = await bake();
    const goldenHtml = await fs.readFile(GOLDEN_HTML, "utf8");
    const goldenCss = await fs.readFile(GOLDEN_CSS, "utf8");
    expect(html).toBe(goldenHtml);
    expect(css ?? "").toBe(goldenCss);
  });

  it("two independent bakes of the same source are byte-identical to each other", async () => {
    const a = await bake();
    const b = await bake();
    expect(a.html).toBe(b.html);
    expect(a.css).toBe(b.css);
  });
});
