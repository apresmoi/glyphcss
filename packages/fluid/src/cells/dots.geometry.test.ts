// The default dot face (core's braille-dots atlas) must put every dot exactly where molty's
// canvas renderer fills it. The REAL GlyphRenderer.draw runs on a recording 2D context;
// every dot rect it fills, as a fraction of its cell, must equal the atlas's dot rect for
// that Unicode bit (font units over the advance × unitsPerEm cell, y flipped from the
// baseline). The font outlines themselves are checked against the same rects by core's
// assets/glyph-atlas/test-atlas.py.
import { describe, expect, it } from "vitest";
import { GLYPH_FONT_ATLAS_BRAILLE_DOTS } from "glyphcss";
import { GlyphRenderer } from "../../reference/molty-fluid/render.js";
import { GlyphFluidSim } from "../sim/sim";
import { configureGlyphFluidRect } from "../sim/ops";
import { GLYPH_FLUID_DOTS_TO_BRAILLE } from "./cells";
import { glyphFluidAtlas } from "./encode";

const PANEL = 412;

/** Every dot rect render.js fills, as [x0, y0, x1, y1] fractions of its own cell (y down). */
function canvasDots(): Map<number, number[][]> {
  const sim = configureGlyphFluidRect(new GlyphFluidSim(40, 25, 8, 12.8), 8, { fieldColor: [0.43, 0.56, 0.51], fieldLevel: 0.18 });
  let seed = 3;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < sim.N; k++) sim.view[k] = rand();
  const cw = PANEL / sim.W, ch = PANEL / sim.H;
  const byQ = new Map<number, number[][]>();
  const rec = {
    setTransform() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, fillText() {},
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      if (w >= PANEL) return;
      const i = Math.floor((x + w / 2) / cw), j = Math.floor((y + h / 2) / ch);
      const r = [(x - i * cw) / cw, (y - j * ch) / ch, (x + w - i * cw) / cw, (y + h - j * ch) / ch];
      // molty's dot index q: column q >> 2, row q & 3
      const q = (r[0]! + r[2]! > 1 ? 4 : 0) + Math.round(((r[1]! + r[3]!) / 2 - 0.14) / 0.24);
      if (!byQ.has(q)) byQ.set(q, []);
      byQ.get(q)!.push(r);
    },
  };
  const g = new GlyphRenderer({ getContext: () => rec });
  g.scale = 1;
  g.draw(sim, { ramp: " .:-=+*#%@", palette: "pastel", braille: "all", edges: 1, time: 0, shimmer: 0.12, letters: [], melt: 0 });
  return byQ;
}

describe("braille-dots face vs molty's canvas dots", () => {
  it("is the fluid's default face", () => {
    expect(glyphFluidAtlas()).toBe(GLYPH_FONT_ATLAS_BRAILLE_DOTS);
  });

  it("places and sizes all eight dots exactly where render.js fills them, on a 1.6 cell", () => {
    const geometry = GLYPH_FONT_ATLAS_BRAILLE_DOTS.dotGeometry!;
    const { unitsPerEm: upm, advance } = geometry;
    expect(upm / advance).toBe(1.6);
    const dots = canvasDots();
    expect([...dots.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const [q, rects] of dots) {
      const bit = Math.log2(GLYPH_FLUID_DOTS_TO_BRAILLE[1 << q]!);
      const [x0, y0, x1, y1] = geometry.dots[bit]!;
      const font = [x0 / advance, (upm - y1) / upm, x1 / advance, (upm - y0) / upm];
      expect(rects.length).toBeGreaterThan(10);
      for (const r of rects) for (let e = 0; e < 4; e++) expect(r[e]).toBeCloseTo(font[e]!, 9);
    }
  });
});
