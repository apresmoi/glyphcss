import { describe, it, expect, vi, afterEach } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";
import { nearestPaletteIndex, packHexColor } from "../render/paletteQuantize";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { GlyphEffectOutputChannel, defineGlyphEffect } from "./effects";
import { GLYPH_FONT_ATLAS } from "../render/fontAtlas";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * The atlas WOFF2 is now a lazily imported chunk (`render/fontAtlasPayload.ts`),
 * so a freshly created `colorEncoding: "atlas"` scene deliberately renders
 * SPANS until it arrives — see `render/fontAtlas.ts`'s async-transition note.
 * Every assertion about real PUA output has to settle that load first. This
 * awaits the same shared, per-document promise `createGlyphScene` awaits, then
 * flushes the re-render it schedules.
 */
async function flushAtlasRenders(): Promise<void> {
  await ensureGlyphAtlasFontFaceStyles(document);
  await flushRenders();
  await flushRenders();
}

function countSpans(html: string): number {
  return (html.match(/<span/g) ?? []).length;
}

// Flat ambient-only lighting keeps rendered color == authored color exactly
// (same convention `createGlyphScene.colorTolerance.test.ts`'s `nearColorQuad`
// uses), and full ambient intensity saturates the shade ramp to its densest
// glyph uniformly, so every covered cell renders the exact same (glyph,
// color) pair — trivially within a one-entry atlasPalette.
const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function flatQuad(color: string): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color }];
}

describe("buildRasterizeContext — colorEncoding validation", () => {
  const baseOpts = {
    camera: createGlyphOrthographicCamera(),
    grid: { cols: 4, rows: 4, cellAspect: 2.0 },
    mode: "wireframe" as const,
  };

  it("defaults to \"spans\" when omitted", () => {
    expect(buildRasterizeContext(baseOpts).colorEncoding).toBe("spans");
  });

  it("passes \"spans\" through explicitly", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorEncoding: "spans" }).colorEncoding).toBe("spans");
  });

  it("passes \"atlas\" through explicitly", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorEncoding: "atlas" }).colorEncoding).toBe("atlas");
  });

  it("throws on an invalid colorEncoding value", () => {
    // @ts-expect-error deliberately invalid at the type level too
    expect(() => buildRasterizeContext({ ...baseOpts, colorEncoding: "bogus" })).toThrow(TypeError);
  });

  it("passes atlasPalette through unchanged", () => {
    const palette = ["#ff0000", "#00ff00"];
    expect(buildRasterizeContext({ ...baseOpts, atlasPalette: palette }).atlasPalette).toBe(palette);
  });

  it("leaves atlasPalette undefined when omitted", () => {
    expect(buildRasterizeContext(baseOpts).atlasPalette).toBeUndefined();
  });
});

describe("rasterize — the spans/atlas gate inside the hot-path coalescers", () => {
  // `createGlyphScene` guards this a second time (it never hands a palette
  // down unless `colorEncoding` is "atlas"), which masks a broken gate here
  // from every scene-level test. These call `rasterize` directly, with a
  // palette supplied ALONGSIDE `colorEncoding: "spans"`, so the coalescers'
  // own short-circuit is the only thing standing between the two encodings —
  // the byte-identity constraint has to hold on its own at this level too.
  const rig = (colorEncoding: "spans" | "atlas") => buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
    grid: { cols: 30, rows: 12, cellAspect: 2.0 },
    mode: "solid",
    doubleSided: true,
    polygons: flatQuad("#336699"),
    colorEncoding,
    atlasPalette: ["#336699"],
    ...FLAT_LIGHTING,
  });

  it("solid mode ignores a supplied palette under \"spans\" and emits identical HTML", () => {
    const spans = rasterize(rig("spans"));
    expect(countSpans(spans)).toBeGreaterThan(0);
    // Same scene, same palette, only the encoding differs — proving the
    // palette was genuinely usable and the "spans" run declined it.
    const atlas = rasterize(rig("atlas"));
    expect(countSpans(atlas)).toBe(0);
    expect(spans).not.toBe(atlas);
  });

  it("wireframe mode's separate coalescer holds the same gate", () => {
    // `glyphPalette: "ascii"` is pinned for simplicity (a small, stable
    // tier set); it is no longer load-bearing for determinism. The DEFAULT
    // wireframe palette's `normal` tier used to include 5 glyphs the
    // Menlo-only atlas silently dropped (⬢⬡∴∵⊥), which made a default-palette
    // wireframe scene's atlas encodability genuinely non-deterministic frame
    // to frame (a wireframe cell's glyph is a random draw from its tier every
    // render). That gap is now closed via vendored fallback source faces
    // (`assets/glyph-atlas/build-atlas.py`) — see the dedicated
    // "default-palette wireframe atlas-encodes deterministically" describe
    // block below for the regression test against the default palette itself.
    const wire = (colorEncoding: "spans" | "atlas") => buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      grid: { cols: 30, rows: 12, cellAspect: 2.0 },
      mode: "wireframe",
      glyphPalette: "ascii",
      polygons: flatQuad("#336699"),
      colorEncoding,
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    const spans = rasterize(wire("spans"));
    expect(countSpans(spans)).toBeGreaterThan(0);
    expect(countSpans(rasterize(wire("atlas")))).toBe(0);
  });
});

describe("createGlyphScene — default-palette wireframe atlas-encodes deterministically", () => {
  // Regression for the 22-glyph coverage gap the checked-in atlas used to
  // have: the "default" wireframe palette's `normal` tier draws from
  // "╋╬┼╳◆◇◊▲△▼▽◈⬡⬢∴∵⊥⊕⊗⊙⊚⊛", 5 of which (⬡⬢∴∵⊥) were missing from the
  // Menlo-only build. A wireframe cell's glyph is a RANDOM draw from its
  // tier on EVERY render (`rasterize.ts`), so with the gap present this was
  // genuinely non-deterministic: a render that happened to draw one of the
  // 5 missing glyphs fell back to spans, `createGlyphScene`'s pin-flip
  // settling-render logic then scheduled another render (which re-rolled the
  // glyphs), and a sparse grid could loop indefinitely (measured: 4 inked
  // cells flipped encodability 946/2000 frames). With the gap closed, every
  // glyph the default palette can draw is in the atlas, so this must hold on
  // EVERY render, not just probabilistically -- `rerender()` forces a fresh
  // random draw each iteration without changing any option.
  it("stays atlas-encoded (zero spans) across many independent random glyph draws on a sparse grid", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 10,
      rows: 5,
      useColors: true,
      mode: "wireframe",
      // glyphPalette omitted -- "default" is the scene's own default, and is
      // exactly the palette the gap was in.
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      camera: createGlyphOrthographicCamera({ zoom: 22 }),
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    let sawInkedCell = false;
    for (let i = 0; i < 300; i++) {
      scene.rerender();
      const html = scene.output.innerHTML;
      expect(html, `render #${i} fell back to spans`).not.toContain("<span");
      if (html.replace(/\s/g, "").length > 0) sawInkedCell = true;
    }
    // Sanity: the loop actually exercised inked (non-blank) wireframe cells,
    // not a degenerate all-blank grid the gap could never have touched.
    expect(sawInkedCell).toBe(true);
    scene.destroy();
    host.remove();
  });
});

describe("createGlyphScene — ascii-palette wireframe atlas-encodes deterministically", () => {
  // The other FULL wireframe palette (`default`'s own regression is above).
  // Proof obligation 2 (F1): the potential-set gate must not have simply
  // disabled the atlas for wireframe wholesale — a fully-covered palette has
  // to stay atlas-encoded on every render, exactly as before this fix.
  it("stays atlas-encoded (zero spans) across many independent random glyph draws", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 10,
      rows: 5,
      useColors: true,
      mode: "wireframe",
      glyphPalette: "ascii",
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      camera: createGlyphOrthographicCamera({ zoom: 22 }),
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    let sawInkedCell = false;
    for (let i = 0; i < 300; i++) {
      scene.rerender();
      const html = scene.output.innerHTML;
      expect(html, `render #${i} fell back to spans`).not.toContain("<span");
      if (html.replace(/\s/g, "").length > 0) sawInkedCell = true;
    }
    expect(sawInkedCell).toBe(true);
    scene.destroy();
    host.remove();
  });
});

describe("createGlyphScene — partially-covered wireframe palettes stay deterministically spans (no oscillation)", () => {
  // Proof obligation 1 (F1): `runes`, `braille`, `blocks`, `stars`, `arrows`
  // and `math` each have at least one tier with a glyph the checked-in atlas
  // doesn't carry (verified against `assets/glyph-atlas/atlas.json`; see
  // AGENTS.md's `colorEncoding` section). Before the potential-set gate, a
  // wireframe cell's glyph is a fresh `Math.random()` draw from its tier every
  // render, so whether THIS frame happened to roll the missing glyph decided
  // spans vs atlas independently each time — measured live (`runes`, 10x5,
  // zoom 4, 300 rerenders): 82 encodability transitions and 82 font-family pin
  // flips. The fix makes this a config-level decision: every render of a
  // partially-covered palette must land on spans, and NEVER flip to atlas
  // partway through — that is the "zero transitions" bar, not merely "mostly
  // spans".
  const PARTIAL_PALETTES = ["runes", "braille", "blocks", "stars", "arrows", "math"];

  it.each(PARTIAL_PALETTES)("glyphPalette %s: every render is spans, with zero spans→atlas transitions", async (glyphPalette) => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 10,
      rows: 5,
      useColors: true,
      mode: "wireframe",
      glyphPalette,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      // Matches the live repro's grid/zoom exactly (10x5, zoom 4) — the
      // sparser silhouette that made the pre-fix realized-set roll visibly
      // flip spans↔atlas frame to frame.
      camera: createGlyphOrthographicCamera({ zoom: 4 }),
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    let transitions = 0;
    let wasAtlas = scene.output.innerHTML.indexOf("<span") === -1;
    let sawInkedCell = false;
    for (let i = 0; i < 300; i++) {
      scene.rerender();
      const html = scene.output.innerHTML;
      const isAtlas = !html.includes("<span");
      if (isAtlas !== wasAtlas) transitions++;
      wasAtlas = isAtlas;
      // The actual requirement: deterministically spans, every single render.
      expect(isAtlas, `render #${i} was atlas-encoded`).toBe(false);
      if (html.replace(/\s/g, "").length > 0) sawInkedCell = true;
    }
    expect(transitions).toBe(0);
    expect(sawInkedCell).toBe(true);
    scene.destroy();
    host.remove();
  });
});

describe("rasterize — partially-covered wireframe palettes gate on the POTENTIAL glyph set, not the realized draw", () => {
  // Deterministic sibling of the describe block above, with the randomness
  // that made three of its six palettes only PROBABILISTICALLY exercise the
  // fix removed entirely: `Math.random()` is stubbed to always return `0`, so
  // `wireframeGlyphForCell` always draws index 0 of whichever tier this
  // fixture's flat-quad edges use ("normal", the default edge weight's tier).
  // Index 0 of every one of these six palettes' `normal` tier IS in the
  // atlas (verified against `assets/glyph-atlas/atlas.json`) — so a
  // REALIZED-only check (the pre-fix behavior `isGlyphAtlasEncodable` alone
  // implements) would find this exact draw encodable on EVERY render, 100%
  // of the time, not just probabilistically. The gate must still force
  // spans, because it looks at the palette's whole POTENTIAL set
  // (`thin ∪ normal ∪ core`), never just what got drawn.
  const PARTIAL_PALETTES = ["runes", "braille", "blocks", "stars", "arrows", "math"];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(PARTIAL_PALETTES)("glyphPalette %s: spans even when every draw lands on an in-atlas glyph", (glyphPalette) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ctx = buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      grid: { cols: 30, rows: 12, cellAspect: 2.0 },
      mode: "wireframe",
      glyphPalette,
      polygons: flatQuad("#336699"),
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    const html = rasterize(ctx);
    expect(countSpans(html)).toBeGreaterThan(0);
    expect(ctx.atlasEncoded).toBe(false);
    expect(ctx.atlasGlyphFallback).toBe(true);
  });
});

describe("createGlyphScene — colorEncoding option plumbing", () => {
  it("defaults to \"spans\" when omitted at construction", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera() });
    expect(scene.getOptions().colorEncoding).toBe("spans");
    scene.destroy();
  });

  it("setOptions updates colorEncoding", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), colorEncoding: "atlas" });
    expect(scene.getOptions().colorEncoding).toBe("atlas");
    scene.setOptions({ colorEncoding: "spans" });
    expect(scene.getOptions().colorEncoding).toBe("spans");
    scene.destroy();
  });

  it("setOptions with atlasPalette omitted leaves the previous value untouched, but an explicit undefined clears it", () => {
    const host = makeDiv();
    const palette = ["#ff0000"];
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), atlasPalette: palette });
    expect(scene.getOptions().atlasPalette).toBe(palette);
    scene.setOptions({ mode: "wireframe" });
    expect(scene.getOptions().atlasPalette).toBe(palette);
    scene.setOptions({ atlasPalette: undefined });
    expect(scene.getOptions().atlasPalette).toBeUndefined();
    scene.destroy();
  });
});

describe("createGlyphScene — colorEncoding \"spans\" (unset/explicit) is byte-identical to before this option existed", () => {
  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
    ...FLAT_LIGHTING,
  };

  async function renderHtml(colorEncoding: "spans" | undefined): Promise<string> {
    const host = makeDiv();
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding });
    scene.add(flatQuad("#336699"));
    await flushRenders();
    const html = scene.output.innerHTML;
    scene.destroy();
    host.remove();
    return html;
  }

  it("produces the exact same HTML whether colorEncoding is omitted or explicitly \"spans\"", async () => {
    const omitted = await renderHtml(undefined);
    const explicit = await renderHtml("spans");
    expect(explicit).toBe(omitted);
    // Sanity: this scene actually renders spans (not a degenerate blank compare).
    expect(countSpans(omitted)).toBeGreaterThan(0);
  });
});

describe("createGlyphScene — colorEncoding \"atlas\" end to end", () => {
  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
    ...FLAT_LIGHTING,
  };

  it("renders zero <span>s as one PUA text node when the palette fully covers the scene", async () => {
    const host = makeDiv();
    const color = "#336699";
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding: "atlas", atlasPalette: [color] });
    scene.add(flatQuad(color));
    await flushAtlasRenders();
    const html = scene.output.innerHTML;
    expect(html).not.toContain("<span");
    // Actually rendered something (not a degenerate blank compare) and used
    // real PUA code points, not the literal glyph — checked across the whole
    // string since the flat quad doesn't necessarily cover the grid's very
    // first cell (near the corners, outside its silhouette, stays blank).
    expect(html.trim().length).toBeGreaterThan(0);
    const codePoints = Array.from(html, (ch) => ch.codePointAt(0)!);
    expect(codePoints.some((cp) => cp >= GLYPH_FONT_ATLAS.puaStart)).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("quantizes to the pinned palette (no span fallback) when it does not cover the scene's actual color", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      ...sceneOptions,
      colorEncoding: "atlas",
      atlasPalette: ["#000000"], // does not match the quad's authored color
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    const html = scene.output.innerHTML;
    // A pinned palette bounds the render's colour resolution; it never decides
    // whether the render can be encoded at all.
    expect(countSpans(html)).toBe(0);
    const codePoints = Array.from(html, (ch) => ch.codePointAt(0)!);
    expect(codePoints.some((cp) => cp >= GLYPH_FONT_ATLAS.puaStart)).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("derives and pools its own palette when colorEncoding is \"atlas\" with no atlasPalette", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding: "atlas" });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    expect(countSpans(scene.output.innerHTML)).toBe(0);
    // The derived palette reached CSS: a slot is meaningless without the
    // `@font-palette-values` block that gives it a colour.
    const blocks = Array.from(document.head.querySelectorAll("style"), (el) => el.textContent ?? "");
    const paletteName = scene.output.style.getPropertyValue("font-palette");
    expect(paletteName).toMatch(/^--glyph-atlas-palette-/);
    expect(blocks.some((css) => css.includes(paletteName) && css.includes("#336699"))).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("quantizes a many-colour Lambert render into the atlas's slot budget instead of falling back", async () => {
    const host = makeDiv();
    // 240 coplanar strips, each authored a distinct colour: far more distinct
    // colours than the atlas has slots, covering the whole grid, and — unlike a
    // lit curved mesh — deterministic, so the assignment check below compares
    // against a stable ground truth rather than a shading accident.
    const STRIPS = 240;
    const facets: Polygon[] = [];
    for (let i = 0; i < STRIPS; i++) {
      const x0 = -6 + (12 * i) / STRIPS;
      const x1 = -6 + (12 * (i + 1)) / STRIPS;
      const t = i / (STRIPS - 1);
      const r = Math.round(40 + t * 200);
      const g = Math.round(200 - t * 150);
      const b = Math.round(90 + Math.sin(t * 7) * 80);
      facets.push({
        vertices: [[x0, -3, 0], [x0, 3, 0], [x1, 3, 0], [x1, -3, 0]],
        color: `#${((r << 16) | (g << 8) | Math.max(0, Math.min(255, b))).toString(16).padStart(6, "0")}`,
      });
    }
    const scene = createGlyphScene(host, {
      cols: 60,
      rows: 24,
      useColors: true,
      mode: "solid",
      doubleSided: true,
      colorEncoding: "atlas",
      camera: createGlyphOrthographicCamera({ zoom: 400 }),
      ...FLAT_LIGHTING,
    });
    scene.add(facets);
    await flushAtlasRenders();
    const html = scene.output.innerHTML;
    expect(countSpans(html)).toBe(0);
    const codePoints = Array.from(html, (ch) => ch.codePointAt(0)!);
    expect(codePoints.some((cp) => cp >= GLYPH_FONT_ATLAS.puaStart)).toBe(true);
    // Every code point stays inside the atlas's slot budget — the encoding is
    // only valid if quantization actually bounded the palette.
    const slots = codePoints
      .filter((cp) => cp >= GLYPH_FONT_ATLAS.puaStart)
      .map((cp) => Math.floor((cp - GLYPH_FONT_ATLAS.puaStart) / GLYPH_FONT_ATLAS.glyphCount));
    expect(Math.max(...slots)).toBeLessThan(GLYPH_FONT_ATLAS.maxPaletteSize);
    expect(new Set(slots).size).toBeGreaterThan(1); // genuinely multi-colour

    // Every cell landed on the NEAREST slot to the colour the span render
    // would have emitted there — the assignment, end to end, against ground
    // truth read out of the same scene rendered as spans. A cell that is off
    // by a slot is a visible wrong colour, and nothing else in this file
    // catches it: bounds and slot-count assertions pass for any assignment.
    const palette = paletteFromCss(scene.output);
    expect(palette.length).toBeGreaterThan(1);
    const packedPalette = palette.map((c) => packHexColor(c)!);
    scene.setOptions({ colorEncoding: "spans" });
    await flushAtlasRenders();
    const truth = spansGrid(scene.output);
    const encoded = decodeAtlasSlots(html);
    expect(encoded.length).toBe(truth.length);
    let checked = 0;
    for (let i = 0; i < truth.length; i++) {
      const c = truth[i];
      if (c === null || encoded[i] === null) continue;
      expect(encoded[i]).toBe(nearestPaletteIndex(packedPalette, packHexColor(c)!));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(new Set(truth.filter(Boolean)).size).toBeGreaterThan(GLYPH_FONT_ATLAS.maxPaletteSize * 3);
    scene.destroy();
    host.remove();
  });
});

/** Palette colours this scene's own `@font-palette-values` block declares, in slot order. */
function paletteFromCss(pre: HTMLElement): string[] {
  const name = pre.style.getPropertyValue("font-palette");
  const block = Array.from(document.head.querySelectorAll("style"), (el) => el.textContent ?? "")
    .find((css) => css.includes(`@font-palette-values ${name}`));
  const overrides = /override-colors:([^;}]+)/.exec(block ?? "")?.[1] ?? "";
  const out: string[] = [];
  for (const entry of overrides.split(",")) {
    const m = /(\d+)\s+(#[0-9a-f]{6})/i.exec(entry);
    if (m) out[Number(m[1])] = m[2]!.toLowerCase();
  }
  return out;
}

/** Per-cell palette slot of an atlas-encoded `<pre>` string, `null` for blanks/newlines. */
function decodeAtlasSlots(html: string): (number | null)[] {
  const out: (number | null)[] = [];
  for (const ch of html) {
    if (ch === "\n") continue;
    const cp = ch.codePointAt(0)!;
    out.push(cp >= GLYPH_FONT_ATLAS.puaStart ? Math.floor((cp - GLYPH_FONT_ATLAS.puaStart) / GLYPH_FONT_ATLAS.glyphCount) : null);
  }
  return out;
}

/** Per-cell true colour of a spans-encoded `<pre>`, in the same cell order. */
function spansGrid(pre: HTMLElement): (string | null)[] {
  const out: (string | null)[] = [];
  const visit = (node: ChildNode, color: string | null): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const ch of node.nodeValue ?? "") {
        if (ch !== "\n") out.push(ch === " " ? null : color);
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const next = el.style?.color || color;
      el.childNodes.forEach((c) => visit(c, next ? String(next).toLowerCase() : null));
    }
  };
  pre.childNodes.forEach((c) => visit(c, null));
  return out;
}

// Mirrors `createGlyphScene.colorTolerance.test.ts`'s two dedicated coverage
// suites for the two `createGlyphScene` call sites that bypass the main
// `rasterize()` pipeline: the retained Glyph Effect recompose path
// (`encodeCellGridOutput`, createGlyphScene.ts) and a per-mesh detail layer's
// own `buildRasterizeContext` call.
function nearColorGradientProgram(color: number) {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output }) {
      const n = output.coverage.length;
      for (let i = 0; i < n; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = "#";
        output.color[i] = color;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph | GlyphEffectOutputChannel.Color;
      }
    },
  });
}

describe("createGlyphScene — colorEncoding reaches the retained-effect recompose path", () => {
  it("renders zero-span atlas output on a params-only recompose (not just the initial full render)", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 20,
      rows: 1,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#802020"],
      camera: createGlyphOrthographicCamera(),
    });
    const layer = scene.addEffectLayer({
      effect: nearColorGradientProgram(0x802020),
      params: { phase: 0 },
      target: "viewport",
      blend: "replace",
    });
    await flushAtlasRenders(); // initial full render — retains the base CellGrid.
    layer.params.phase = 1; // params-only write — takes the recompose path, not rasterize().
    await flushAtlasRenders();
    const html = scene.output.innerHTML;
    expect(html).not.toContain("<span");
    expect(html.trim().length).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });
});

/**
 * An effect program glyphcss cannot know the potential glyph set of in
 * advance (unlike the wireframe palette tiers `isWireframePaletteAtlasEncodable`
 * gates on): it emits an in-atlas glyph ("#") when `params.phase` is `0`, and
 * a glyph the checked-in atlas does NOT carry ("ᚡ", the same out-of-atlas
 * rune `cells.colorEncoding.test.ts` uses as its fixture) otherwise.
 */
function atlasBoundaryProgram(color: number) {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output, params }) {
      const glyph = params.phase === 0 ? "#" : "ᚡ";
      const n = output.coverage.length;
      for (let i = 0; i < n; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = glyph;
        output.color[i] = color;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph | GlyphEffectOutputChannel.Color;
      }
    },
  });
}

describe("createGlyphScene — out-of-atlas-glyph fallback is sticky (F1 fix B)", () => {
  it("latches spans on a glyph-driven fallback and holds it even once the data would re-qualify, clearing only on a relevant setOptions", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 20,
      rows: 1,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#802020"],
      camera: createGlyphOrthographicCamera(),
    });
    const layer = scene.addEffectLayer({
      effect: atlasBoundaryProgram(0x802020),
      params: { phase: 0 },
      target: "viewport",
      blend: "replace",
    });
    await flushAtlasRenders(); // phase 0: fully in-atlas — establishes the baseline.
    expect(scene.output.innerHTML).not.toContain("<span");

    layer.params.phase = 1; // phase 1: every cell now draws the out-of-atlas rune.
    await flushAtlasRenders();
    expect(scene.output.innerHTML).toContain("<span");

    layer.params.phase = 0; // Back to fully in-atlas data — NO setOptions call.
    await flushAtlasRenders();
    // The sticky latch, not the data, decides: still spans.
    expect(scene.output.innerHTML).toContain("<span");

    // A setOptions call touching `colorEncoding` clears the latch (same value,
    // but the field is explicitly touched — see AGENTS.md's `colorEncoding`
    // section for the exact reset list).
    scene.setOptions({ colorEncoding: "atlas" });
    await flushAtlasRenders();
    expect(scene.output.innerHTML).not.toContain("<span");

    scene.destroy();
    host.remove();
  });

  it("does not latch on a colour-only fallback reason", async () => {
    // `glyphPalette: "ascii"` is fully atlas-covered (see the dedicated
    // describe block above), so every wireframe glyph this scene can draw is
    // in-atlas — the ONLY way this falls back to spans is the raw, non-
    // `#rrggbb` CSS colour name wireframe edges forward unchecked
    // (`rasterize.ts`'s `drawLineToStamp(..., e.color ?? null, ...)`; the
    // same mechanism `colorEncoding.fallbackFont.test.ts`'s "P1-A" fixture
    // uses). That is a structural COLOUR failure, not a glyph one, and must
    // never engage the sticky latch.
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 20,
      rows: 10,
      useColors: true,
      mode: "wireframe",
      glyphPalette: "ascii",
      colorEncoding: "atlas",
      atlasPalette: ["#802020"],
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
    });
    const mesh = scene.add(flatQuad("red")); // raw CSS name, not #rrggbb -> colour-only fallback.
    await flushAtlasRenders();
    expect(scene.output.innerHTML).toContain("<span");

    // No setOptions at all — only the mesh's own colour becomes valid again.
    mesh.setPolygons(flatQuad("#802020"));
    await flushAtlasRenders();
    expect(scene.output.innerHTML).not.toContain("<span");

    scene.destroy();
    host.remove();
  });
});

// Proof obligation 3 (F1) — the font-ready spans→atlas transition itself —
// lives in `fontAtlas.lazy.test.ts`, which already holds the dedicated
// `setGlyphAtlasFontPayloadImportForTests` gate infrastructure needed to
// observe the pre-load window reliably (a real payload import resolves in a
// single microtask here, too fast to assert against directly).

describe("createGlyphScene — colorEncoding reaches a per-mesh detail layer's buildRasterizeContext", () => {
  it("renders zero-span atlas output on the detail <pre>", async () => {
    const host = makeDiv();
    const color = "#802020";
    const scene = createGlyphScene(host, {
      cols: 60,
      rows: 16,
      useColors: true,
      mode: "solid",
      doubleSided: true,
      colorEncoding: "atlas",
      atlasPalette: [color],
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      ...FLAT_LIGHTING,
    });
    // `density` (any value != 1) pops this mesh into its own detail `<pre>`,
    // rendered through the detail-layer `buildRasterizeContext` call.
    scene.add(flatQuad(color), { density: 2 });
    await flushAtlasRenders();
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement | null;
    expect(detail).not.toBeNull();
    expect(detail!.innerHTML).not.toContain("<span");
    expect(detail!.textContent!.trim().length).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });
});
