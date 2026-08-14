/**
 * compileScene — render a scene to its `<pre>` text **without a DOM**.
 *
 * `rasterize` is pure (geometry + camera → string), so a scene can be rendered
 * at build time / on the server / in a worker. This reproduces the exact render
 * path of `createGlyphScene` (same defaults, same RasterizeContext) but returns
 * the HTML string instead of mutating a `<pre>`. It is the foundation of the
 * static-compile toolchain (Vite plugin, CLI, SSR).
 *
 * Defaults are identical to `createGlyphScene` so a compiled scene matches the
 * runtime render 1:1.
 */
import type { Polygon, RenderMode } from "@glyphcss/core";
import { recenterPolygons } from "@glyphcss/core";
import type { GlyphCamera } from "./createGlyphCamera";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";
import { encodeGlyphBuffers } from "../render/cells";
import { buildGlyphControlFrame } from "./controlFrame";
import type { GlyphControlSceneManifest, GlyphObjectDictionary } from "./controlFrame";
import type {
  GlyphDirectionalLight,
  GlyphAmbientLight,
  GlyphShadowOptions,
  GlyphSolidWeightRampStep,
} from "./types";

export interface CompileSceneOptions {
  /** Polygons to render (already loaded — see the Vite plugin / CLI for files). */
  polygons: Polygon[];
  /** Camera. Default: `createGlyphPerspectiveCamera()` (same as createGlyphScene). */
  camera?: GlyphCamera;
  /** Recenter the mesh bbox to the origin before rendering (matches `autoCenter`). Default false. */
  autoCenter?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  glyphPalette?: string;
  /**
   * Character encoding for rasterized output. `"ascii"` (default) is the
   * original ramp/rule-glyph encoding; `"braille"`/`"halfblock"` match the
   * runtime scene option — see {@link RasterizeContextOptions.charMode}.
   */
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  /**
   * Hidden-line removal for the wireframe path (wireframe + `charMode:
   * "braille"`); `"show"` default matches the runtime scene option — see
   * {@link RasterizeContextOptions.hiddenLines}. Exposed here (unlike
   * `wireframeJunctions`, which is runtime-only) because it is a pure
   * function of geometry + camera, exactly like `charMode`, and fixes a
   * genuine occlusion defect a static bake shouldn't reproduce.
   */
  hiddenLines?: "show" | "hide";
  /**
   * Solid-mode-only font-weight density ramp — see
   * {@link RasterizeContextOptions.solidWeightRamp}. A calibrated `(glyph,
   * weight)[]` step list is plain data (produced ahead of time by
   * `@glyphcss/effects`'s `calibrateWeightedGlyphRamp`), so it bakes here
   * exactly like `charMode` — no browser/canvas dependency at compile time.
   */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
  /** Render both sides, but keep Lambert lighting on the authored normal. */
  doubleSided?: boolean;
  supersample?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  shadow?: GlyphShadowOptions;
  /** Select appearance-shaded output (default) or dictionary-semantic solid output. */
  glyphOutput?: "visible" | "semantic";
  /** Immutable polygon lineage required by semantic output. */
  sceneManifest?: GlyphControlSceneManifest;
  /** Immutable class dictionary required by semantic output. */
  dictionary?: GlyphObjectDictionary;
}

export interface CompileSceneResult {
  /** `<pre class="glyph-output">…</pre>` — ready to inline into HTML. */
  html: string;
  /** Just the inner content (colored spans, or escaped text). */
  inner: string;
  cols: number;
  rows: number;
  cellAspect: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function compileScene(opts: CompileSceneOptions): CompileSceneResult {
  // Library-identical defaults (see createGlyphScene).
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const cellAspect = opts.cellAspect ?? 2.0;
  const mode: RenderMode = opts.mode ?? "solid";
  const useColors = opts.useColors ?? true;
  const camera = opts.camera ?? createGlyphPerspectiveCamera();

  const polygons = opts.autoCenter ? recenterPolygons(opts.polygons) : opts.polygons;

  if (opts.glyphOutput === "semantic") {
    if (mode !== "solid") throw new RangeError("glyphcss: semantic glyph output requires solid mode.");
    if (!opts.sceneManifest || !opts.dictionary) {
      throw new TypeError("glyphcss: semantic glyph output requires sceneManifest and dictionary.");
    }
    const frame = buildGlyphControlFrame({
      polygons,
      scene: opts.sceneManifest,
      dictionary: opts.dictionary,
      camera,
      grid: { cols, rows, cellAspect },
      mode,
      directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
      ambientLight: opts.ambientLight ?? { intensity: 0.4 },
      glyphPalette: opts.glyphPalette ?? "default",
      smoothShading: opts.smoothShading ?? false,
      creaseAngle: opts.creaseAngle ?? 60,
      doubleSided: opts.doubleSided ?? false,
      supersample: opts.supersample ?? 1,
      shadow: opts.shadow,
    });
    const chars = frame.semanticAscii.replace(/\n/g, "").split("");
    const colors = Array.from(frame.semanticColor, (packed) => packed === 0
      ? null
      : `#${(packed & 0xffffff).toString(16).padStart(6, "0")}`);
    const output = encodeGlyphBuffers(chars, colors, cols, rows, useColors);
    const inner = useColors ? output : escapeHtml(output);
    return { html: `<pre class="glyph-output">${inner}</pre>`, inner, cols, rows, cellAspect };
  }
  if (opts.glyphOutput !== undefined && opts.glyphOutput !== "visible") {
    throw new TypeError('glyphcss: glyphOutput must be "visible" or "semantic".');
  }

  const ctx = buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect },
    polygons,
    mode,
    directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: opts.ambientLight ?? { intensity: 0.4 },
    glyphPalette: opts.glyphPalette ?? "default",
    charMode: opts.charMode,
    hiddenLines: opts.hiddenLines,
    solidWeightRamp: opts.solidWeightRamp,
    useColors,
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    shadow: opts.shadow,
  });
  // Per-cell texture sampling needs browser image decoding (not Node-safe), so
  // the static compile renders from material / vertex colors — the same fallback
  // the runtime uses before its async samplers resolve.

  const output = rasterize(ctx);
  // Colored output is HTML (spans); plain output is text → escape for inlining.
  const inner = useColors ? output : escapeHtml(output);
  return {
    html: `<pre class="glyph-output">${inner}</pre>`,
    inner,
    cols,
    rows,
    cellAspect,
  };
}
