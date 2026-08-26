/**
 * The atlas font stack must never straddle a fallback frame.
 *
 * `colorEncoding: "atlas"` is a REQUEST. Any frame whose glyphs, colours or
 * palette the atlas can't carry — the pre-ready window, `charMode: "braille"`,
 * an exotic wireframe palette, an out-of-atlas field-synth ramp glyph — falls
 * back to the span encoder. Pinning `font-family: "GlyphCssAtlas", monospace`
 * on the strength of the OPTION therefore left those frames rendering in two
 * fonts at once, because the atlas cmap covers `U+0020` alongside its own PUA
 * range (`build-atlas.py`: `cmap = {0x0020: "space"}`, which atlas frames need,
 * since they write blank cells as literal spaces). Spaces came from the atlas
 * at its own advance; every other character came from the platform
 * `monospace`. Invisible on macOS, where `monospace` IS the atlas's source
 * face — and measured broken everywhere else: 40 spaces 394.92px vs 40 "M"
 * 393.67px in Chromium and WebKit, 389px vs 537px against a proportional
 * fallback, ~9% drift per space where `monospace` maps to Consolas.
 *
 * The same cmap fact broke measurement in the other direction: the cell probe
 * used "M", which is NOT in the atlas cmap, so an atlas-pinned `<pre>` was
 * measured in the fallback font it does not paint in.
 *
 * These tests assert the two halves of one invariant:
 *   1. every character of a committed frame resolves from the SAME font;
 *   2. the measured cell advance is the advance of the font that paints.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { GLYPH_FONT_ATLAS } from "../render/fontAtlas";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";
import type { Polygon } from "@glyphcss/core";

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function flatQuad(color: string): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color }];
}

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushAtlasRenders(): Promise<void> {
  await ensureGlyphAtlasFontFaceStyles(document);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

const ATLAS_PUA_END = GLYPH_FONT_ATLAS.puaStart + GLYPH_FONT_ATLAS.glyphCount * GLYPH_FONT_ATLAS.maxPaletteSize;

/**
 * Is this code point in the atlas font's cmap? The atlas maps `U+0020` plus
 * its own PUA block and nothing else — the premise the whole finding rests on,
 * pinned against `build-atlas.py` by the first test below so it cannot rot.
 */
function inAtlasCmap(codePoint: number): boolean {
  return codePoint === 0x20 || (codePoint >= GLYPH_FONT_ATLAS.puaStart && codePoint < ATLAS_PUA_END);
}

function atlasIsFirstInStack(el: HTMLElement): boolean {
  return el.style.fontFamily.includes(GLYPH_FONT_ATLAS.family);
}

// Shared by every describe block below that needs the two fonts modelled
// with DIFFERENT advances — the real case this feature ships into
// (`monospace` → Consolas on Windows at ~0.55em against the atlas's
// Menlo-derived 0.60205em) and the one macOS hides, because there
// `monospace` IS the atlas's source face and every metric agrees by
// accident.
const ATLAS_ADVANCE = 12.041;
const FALLBACK_ADVANCE = 11;
const LINE_HEIGHT = 16;
const HOST_WIDTH = 1000;
const HOST_HEIGHT = 480;

/** Nearest ancestor inline `font-family`, i.e. what `inherit` resolves to. */
function inheritedFamily(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const family = (node as HTMLElement).style?.fontFamily ?? "";
    if (family && family !== "inherit") return family;
  }
  return "";
}

/**
 * Model a text layout engine closely enough to catch the defect: a
 * character's advance comes from the font that RESOLVES it, which for the
 * atlas means "first in the stack AND in its cmap". Probing an atlas-pinned
 * node with "M" therefore reports the fallback advance.
 */
function stubTextLayout(atlasAdvance: number, fallbackAdvance: number): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const lines = (this.textContent ?? "").split("\n");
    const isCellProbe = lines.length === 20 && lines.every((line) => [...line].length === 1)
      && new Set(lines).size === 1;
    const empty = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    if (!isCellProbe) return empty;
    const atlasFirst = inheritedFamily(this).includes(GLYPH_FONT_ATLAS.family);
    const width = atlasFirst && inAtlasCmap(lines[0]!.codePointAt(0)!) ? atlasAdvance : fallbackAdvance;
    const height = LINE_HEIGHT * 20;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

/**
 * Which fonts actually paint this `<pre>`'s committed text. Font selection is
 * per character by cmap: the atlas serves a character iff it is first in the
 * stack AND covers that code point; everything else falls through to
 * `monospace`. More than one entry in this set means one grid, two advances.
 */
function paintingFonts(el: HTMLPreElement): Set<"atlas" | "fallback"> {
  const atlasFirst = atlasIsFirstInStack(el);
  const fonts = new Set<"atlas" | "fallback">();
  for (const ch of el.textContent ?? "") {
    if (ch === "\n") continue;
    fonts.add(atlasFirst && inAtlasCmap(ch.codePointAt(0)!) ? "atlas" : "fallback");
  }
  return fonts;
}

/** A frame with no space, or with nothing but spaces, cannot expose the bug. */
function assertFrameCanExposeMixedFonts(el: HTMLPreElement): void {
  const text = (el.textContent ?? "").replace(/\n/g, "");
  expect(text).toContain(" ");
  expect(text.replace(/ /g, "").length).toBeGreaterThan(0);
}

afterEach(() => {
  document.head.querySelectorAll("style").forEach((el) => {
    if (el.id === FONT_FACE_STYLE_ID || (el.textContent ?? "").includes("@font-palette-values")) el.remove();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("colorEncoding: \"atlas\" — one frame, one font", () => {
  it("the atlas cmap really does cover U+0020 (the premise these tests rest on)", () => {
    // vitest runs with the package root as cwd (`pnpm -r test`).
    const buildScript = readFileSync(resolve(process.cwd(), "assets/glyph-atlas/build-atlas.py"), "utf8");
    // If this ever stops being true, `inAtlasCmap` above is wrong and every
    // "one font" assertion below quietly weakens to a tautology.
    expect(buildScript).toContain("cmap = {0x0020: \"space\"}");
  });

  it("an atlas-encoded frame paints every character — spaces included — from the atlas", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();

    expect(scene.output.innerHTML).not.toContain("<span");
    assertFrameCanExposeMixedFonts(scene.output);
    expect(atlasIsFirstInStack(scene.output)).toBe(true);
    expect([...paintingFonts(scene.output)]).toEqual(["atlas"]);

    scene.destroy();
    host.remove();
  });

  it("a spans-fallback frame paints every character — spaces included — from the fallback", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "wireframe",
      // Braille dot patterns are deliberately outside the universal atlas, so
      // this scene falls back on every frame however ready the font is.
      charMode: "braille",
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();

    // The font IS available — this is a content fallback, not the pre-ready
    // window — which is exactly the case the old `options.colorEncoding` test
    // could not distinguish.
    expect(document.getElementById(FONT_FACE_STYLE_ID)).not.toBeNull();
    expect(scene.output.innerHTML).toContain("<span");
    assertFrameCanExposeMixedFonts(scene.output);
    // The invariant, asserted before the mechanism: ONE font over the whole
    // grid. Pinning the family here would put the spaces on the atlas and
    // everything else on `monospace`.
    expect([...paintingFonts(scene.output)]).toEqual(["fallback"]);
    expect(atlasIsFirstInStack(scene.output)).toBe(false);

    scene.destroy();
    host.remove();
  });

  it("a pooled-palette scene still gets both halves of the wiring on the frame it encodes", async () => {
    // The family is pinned at commit and the `@font-palette-values` ident is
    // published right after it, in the same cycle — a slot is meaningless
    // without the block that declares it.
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();

    expect(atlasIsFirstInStack(scene.output)).toBe(true);
    const paletteName = scene.output.style.getPropertyValue("font-palette").trim();
    expect(paletteName).toMatch(/^--glyph-atlas-palette-\d+$/);
    const block = Array.from(document.head.querySelectorAll("style"))
      .find((el) => (el.textContent ?? "").includes(paletteName));
    expect(block?.textContent).toContain("@font-palette-values");

    scene.destroy();
    host.remove();
  });

  it("a permanently-unencodable scene never pools, repools or publishes a palette", async () => {
    // The structural encodability test runs BEFORE the palette resolves. With
    // the two the other way round, a scene the atlas can never carry still fed
    // the pooled quantizer, still repooled on its refresh window, and still
    // rewrote `@font-palette-values` for slots no `<pre>` would ever reference.
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "wireframe",
      charMode: "braille",
      useColors: true,
      colorEncoding: "atlas",
      // No pinned palette: this is the pooled-quantizer path.
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    for (let frame = 0; frame < 4; frame++) {
      await flushAtlasRenders();
      scene.rerender();
    }
    await flushAtlasRenders();

    expect(scene.output.innerHTML).toContain("<span");
    const paletteBlocks = Array.from(document.head.querySelectorAll("style"))
      .filter((el) => (el.textContent ?? "").includes("@font-palette-values"));
    expect(paletteBlocks).toHaveLength(0);
    expect(scene.output.style.getPropertyValue("font-palette")).toBe("");

    scene.destroy();
    host.remove();
  });

  it("unpins again when a live scene switches from an encodable to an unencodable mode", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    expect(atlasIsFirstInStack(scene.output)).toBe(true);

    scene.setOptions({ mode: "wireframe", charMode: "braille" });
    await flushAtlasRenders();

    expect(scene.output.innerHTML).toContain("<span");
    expect([...paintingFonts(scene.output)]).toEqual(["fallback"]);
    expect(atlasIsFirstInStack(scene.output)).toBe(false);

    scene.destroy();
    host.remove();
  });
});

/**
 * The measurement half.
 *
 * The two fonts are modelled with DIFFERENT advances — the real case this
 * feature ships into (`monospace` → Consolas on Windows at ~0.55em against the
 * atlas's Menlo-derived 0.60205em) and the one macOS hides, because there
 * `monospace` IS the atlas's source face and every metric agrees by accident.
 *
 * The assertion is differential rather than analytic: a scene that PAINTS in
 * the atlas must produce identical geometry whether or not the fallback font
 * has the same metrics, because the fallback font is not painting any of its
 * characters. Probing with "M" — which the atlas cmap does not cover — breaks
 * exactly that, and the control run is what makes the break visible without
 * re-deriving the projection maths here.
 */
describe("colorEncoding: \"atlas\" — the cell probe measures the font that paints", () => {
  interface Geometry { cols: number; hotspotLeft: number; atlasPinned: boolean }

  /** Render one atlas-painting scene under a given pair of font metrics. */
  async function atlasSceneGeometry(atlasAdvance: number, fallbackAdvance: number): Promise<Geometry> {
    stubTextLayout(atlasAdvance, fallbackAdvance);
    const host = makeDiv();
    Object.defineProperty(host, "clientWidth", { value: HOST_WIDTH, configurable: true });
    Object.defineProperty(host, "clientHeight", { value: HOST_HEIGHT, configurable: true });
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      autoSize: true,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    const hotspot = scene.addHotspot({ id: "probe", at: [0, 0, 0] });
    await flushAtlasRenders();
    scene.fit();
    await flushAtlasRenders();
    scene.rerender();
    const geometry: Geometry = {
      cols: scene.getOptions().cols,
      hotspotLeft: parseFloat(hotspot.el.style.left),
      atlasPinned: atlasIsFirstInStack(scene.output),
    };
    scene.destroy();
    host.remove();
    vi.restoreAllMocks();
    return geometry;
  }

  it("an atlas-painting scene's grid and hotspots do not depend on the FALLBACK font's metrics", async () => {
    const real = await atlasSceneGeometry(ATLAS_ADVANCE, FALLBACK_ADVANCE);
    // Control: a world where the fallback font happens to have the atlas's own
    // metrics. This is macOS, and it is why the defect was invisible there.
    const control = await atlasSceneGeometry(ATLAS_ADVANCE, ATLAS_ADVANCE);
    // Sensitivity: the quantities compared below really do move with the
    // advance, so agreeing with the control is evidence and not a tautology.
    const wrongFont = await atlasSceneGeometry(FALLBACK_ADVANCE, FALLBACK_ADVANCE);

    expect(real.atlasPinned).toBe(true);
    expect(control.cols).not.toBe(wrongFont.cols);
    expect(control.hotspotLeft).not.toBe(wrongFont.hotspotLeft);

    expect(real.cols).toBe(control.cols);
    expect(real.hotspotLeft).toBe(control.hotspotLeft);
  });

  it("a spans-painting scene measures the fallback font it really paints in", async () => {
    stubTextLayout(ATLAS_ADVANCE, FALLBACK_ADVANCE);
    const host = makeDiv();
    Object.defineProperty(host, "clientWidth", { value: HOST_WIDTH, configurable: true });
    Object.defineProperty(host, "clientHeight", { value: HOST_HEIGHT, configurable: true });
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      autoSize: true,
      mode: "wireframe",
      charMode: "braille",
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    await flushAtlasRenders();
    scene.fit();
    await flushAtlasRenders();

    expect(atlasIsFirstInStack(scene.output)).toBe(false);
    expect(scene.getOptions().cols).toBe(Math.floor(HOST_WIDTH / FALLBACK_ADVANCE));

    scene.destroy();
    host.remove();
  });
});
