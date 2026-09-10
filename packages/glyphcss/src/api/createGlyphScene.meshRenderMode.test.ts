/**
 * Per-mesh `mode` (GlyphMeshTransform.mode) — a mesh can rasterize in its OWN
 * render mode, in its own detail layer, while the rest of the scene keeps the
 * scene's mode. Same structural reason `glyphPalette`/`ambientIntensity`
 * already force separation: the shared `<pre>` is rasterized in ONE pass under
 * ONE mode.
 *
 * The first two tests are the COST GATE, and `BASELINE_DIGEST` was captured on
 * the renderer as it stood BEFORE per-mesh `mode` existed: a scene where no
 * mesh declares one must still produce that exact string, in exactly one
 * `<pre>`, with no detail layer allocated. Every extra mode is a full extra
 * rasterizer pass, and `base-raster` is ~99% of a full-screen `/maps` frame
 * (bench/maps-render).
 *
 * Fixture discipline, both halves of it:
 *  - The quad is wound FRONT-FACING and the grid is asserted non-blank. The
 *    back-facing winding renders solid identically but leaves `ink` completely
 *    BLANK, and a blank grid passes every assertion about what a mode did not
 *    draw.
 *  - `stubMonospaceMetrics` gives the cell probes a real advance. happy-dom
 *    has no layout, so `measureCellOf` falls back to 8x16 while the CAMERA
 *    falls back to `BASE_TILE / cellAspect` (25px) — a 3.125x disagreement
 *    that over-zooms every detail layer until its silhouette falls off its own
 *    grid. Solid survives that (it fills every cell either way); `ink` and
 *    `wireframe` render blank, so the mode under test would be untestable.
 *    The stub reports exactly the camera's own fallback cell, which is why the
 *    base render — and so `BASELINE_DIGEST` — is unaffected by it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { GlyphSceneOptions } from "./types";
import type { Polygon } from "@glyphcss/core";

const COLS = 32;
const ROWS = 24;
const CELL_ASPECT = 2;
/** `BASE_TILE / cellAspect` — the advance the camera assumes when nothing is measured. */
const CELL_W = 25;
const CELL_H = CELL_W * CELL_ASPECT;
const BASE_FONT_PX = 16;

/** Captured from this exact fixture on the renderer BEFORE per-mesh `mode` existed. */
const BASELINE_DIGEST = "791:5d97706d";

function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(16).padStart(8, "0")}`;
}

/** Ink's own oriented-glyph set (`rasterizeInk`), plus wireframe's rules. */
const STROKE_GLYPHS = /[_/\\|\-‾▔▏▕]/;

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

/**
 * Answers ONLY `measureCellOf`'s hidden probe — the one element whose rect
 * glyphcss turns into a cell size. It is identifiable by the style that
 * function appends to every probe it builds, and holds N lines of a single
 * character, so one advance per line is the faithful answer.
 */
function stubMonospaceMetrics(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    const width = CELL_W * k;
    const height = CELL_H * k * lines;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function makeHost(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** FRONT-FACING winding — see the file doc's fixture note. */
function quad(z: number, a0 = -1, a1 = 1, b0 = -1, b1 = 1): Polygon[] {
  return [{ vertices: [[a0, b0, z], [a1, b0, z], [a1, b1, z], [a0, b1, z]], color: "#ffffff" }];
}

function makeScene(host: HTMLElement, extra: Partial<GlyphSceneOptions> = {}) {
  return createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 360 }),
    cols: COLS, rows: ROWS, cellAspect: CELL_ASPECT,
    mode: "solid", useColors: false,
    glyphPalette: "ascii",
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
    ...extra,
  });
}

function detailPres(host: HTMLElement): HTMLPreElement[] {
  return Array.from(host.querySelectorAll("pre.glyph-output--detail"));
}

function nonBlankRatio(text: string): number {
  const cells = text.replace(/\n/g, "");
  if (cells.length === 0) return 0;
  let filled = 0;
  for (const ch of cells) if (ch !== " ") filled++;
  return filled / cells.length;
}

describe("per-mesh mode — the no-mode path is unchanged", () => {
  it("no mesh declares a mode: byte-identical output, one <pre>, no detail layer", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5));
    scene.rerender();

    const out = scene.output.textContent ?? "";
    expect(nonBlankRatio(out)).toBeGreaterThan(0.2);
    expect(digest(out)).toBe(BASELINE_DIGEST);
    expect(host.querySelectorAll("pre.glyph-output").length).toBe(1);
    expect(detailPres(host).length).toBe(0);
    scene.destroy();
  });

  it("declaring the SCENE's own mode costs nothing: same bytes, still one pass", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { mode: "solid" });
    scene.rerender();

    expect(digest(scene.output.textContent ?? "")).toBe(BASELINE_DIGEST);
    expect(detailPres(host).length).toBe(0);
    scene.destroy();
  });
});

describe("per-mesh mode — a genuinely different mode separates", () => {
  it("renders that mesh in its OWN <pre> in its own mode, and drops it from the base grid", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { mode: "ink", transparent: true });
    scene.rerender();

    const pres = detailPres(host);
    expect(pres.length).toBe(1);

    const detail = pres[0]!.textContent ?? "";
    // Ink draws the silhouette only — its own fixed oriented-glyph set, never
    // the solid ramp's brightest character the same quad renders as in the
    // base pass, and never a filled interior.
    expect(detail).not.toContain("@");
    expect(STROKE_GLYPHS.test(detail)).toBe(true);
    const ratio = nonBlankRatio(detail);
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.6);

    // The base grid still carries the full-size quad it always did.
    expect(scene.output.textContent ?? "").toContain("@");
    scene.destroy();
  });

  it("the SAME mesh renders solid when it declares no mode — the mode is what changed the glyphs", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { density: 2, transparent: true });
    scene.rerender();

    const detail = detailPres(host)[0]!.textContent ?? "";
    expect(detail).toContain("@");
    expect(STROKE_GLYPHS.test(detail)).toBe(false);
    scene.destroy();
  });

  it("mode ALONE pops the mesh out — no density, no fontSize, no transparency", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0), { mode: "wireframe" });
    scene.rerender();

    expect(detailPres(host).length).toBe(1);
    // Wireframe draws the quad's rules only (the "ascii" palette's own `x*+`
    // tiers), never the solid ramp filling every covered cell.
    const detail = detailPres(host)[0]!.textContent ?? "";
    expect(detail).not.toContain("@");
    expect(nonBlankRatio(detail)).toBeGreaterThan(0.05);
    expect(nonBlankRatio(detail)).toBeLessThan(0.5);
    expect(scene.output.textContent ?? "").not.toContain("@");
    scene.destroy();
  });

  it("rejoins the base grid when the scene's own mode changes to match", () => {
    stubMonospaceMetrics();
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    // No `transparent` here: that separates a mesh on its own, and the point
    // of this test is that MODE is what separated it.
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { mode: "ink" });
    scene.rerender();
    expect(detailPres(host).length).toBe(1);

    scene.setOptions({ mode: "ink" });
    scene.rerender();
    expect(detailPres(host).length).toBe(0);
    scene.destroy();
  });
});

describe("per-mesh mode — cross-layer occlusion still applies", () => {
  it("an OPAQUE mode-separated mesh blanks the base cells it owns", () => {
    stubMonospaceMetrics();
    const transparentHost = makeHost();
    const opaqueHost = makeHost();

    const transparentScene = makeScene(transparentHost);
    transparentScene.add(quad(0));
    transparentScene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { mode: "ink", transparent: true });
    transparentScene.rerender();
    const withTransparent = nonBlankRatio(transparentScene.output.textContent ?? "");

    const opaqueScene = makeScene(opaqueHost);
    opaqueScene.add(quad(0));
    opaqueScene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { mode: "ink" });
    opaqueScene.rerender();
    const withOpaque = nonBlankRatio(opaqueScene.output.textContent ?? "");

    // The opaque ink layer claims its own footprint in the shared id-map, so
    // the base grid is blanked under it; the transparent one claims nothing.
    expect(withTransparent).toBeGreaterThan(0.2);
    expect(withOpaque).toBeLessThan(withTransparent);
    transparentScene.destroy();
    opaqueScene.destroy();
  });
});
