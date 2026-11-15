/**
 * Turntable exports with **zero runtime**: no mesh, no glyphcss, just
 * pre-rendered text frames and an animation that shows one at a time.
 *
 *   - `buildGlyphFramesExport` — HTML + CSS, for a page or a CodePen.
 *   - `buildGlyphFramesSvgExport` — one SVG file, for anywhere that takes an
 *     image but strips scripts and styles (a README, an issue, an email).
 *
 * This is the "do better than shipping the mesh" path for orbit-class motion:
 * the reachable views (yaw angles) are a small discrete set, so we render them
 * ahead of time. Each frame is a full `compileScene` render, so colors are
 * faithful (per-face baked for textured meshes). Trade-offs: discrete angles
 * (smoothness ∝ frameCount), fixed resolution, and payload = frameCount × frame.
 */
import type { Polygon, RenderMode, Vec3 } from "@glyphcss/core";
import { recenterPolygons } from "@glyphcss/core";
import { compileScene } from "./compileScene";
import type { GlyphAmbientLight, GlyphDirectionalLight, GlyphShadowOptions } from "./types";
import { createGlyphPerspectiveCamera, createGlyphOrthographicCamera } from "./createGlyphCamera";
import { encodeStaticGlyphHtml, cropGlyphFrames } from "./staticEncode";

export interface GlyphFramesExportOptions {
  /** Number of turntable frames over 360°. Default 36 (10° steps). */
  frameCount?: number;
  /** Full-rotation duration in seconds. Default 8. */
  durationSec?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: "perspective" | "orthographic";
  perspectivePx?: number;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  glyphPalette?: string;
  useColors?: boolean;
  autoCenter?: boolean;
  /**
   * Scale `zoom` so the whole turn fills `cols` × `rows`, whatever the model's
   * own units. The turntable is re-baked until it fits, so this costs a few
   * extra renders of every frame.
   */
  fit?: boolean;
  /** Rendered line-height in px (for exact frame height). Default = fontSizePx. */
  lineHeightPx?: number;
  fontSizePx?: number;
  /** Lighting, as in `compileScene`. The camera orbits, so light stays fixed to the model. */
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  /** Makes the model cast shadows onto itself. They turn with the model, like the light. */
  shadow?: GlyphShadowOptions;
  /**
   * `"roll"` (default): every frame in one tall `<pre>`, slid one frame per
   * step. `"stack"`: one `<pre>` per frame in the same spot, switched by
   * `visibility`, so a frame change repaints one frame of text and the page
   * holds no tall composited strip.
   */
  layout?: "roll" | "stack";
}

export interface GlyphFramesExportResult {
  html: string;
  pen: { html: string; css: string; js: string };
  frameCount: number;
}

export type GlyphFramesSvgExportOptions = Omit<GlyphFramesExportOptions, "layout">;

export interface GlyphFramesSvgExportResult {
  /** A complete SVG document. It animates wherever it is shown as an image. */
  svg: string;
  /** Intrinsic size in CSS px. */
  width: number;
  height: number;
  frameCount: number;
}

const FONT = "ui-monospace,Menlo,monospace";
// The widest advance among the monospace faces the stack resolves to; the SVG
// box is sized by it so no platform clips the last column.
const SVG_ADVANCE = 0.61;

interface Turntable {
  frameCount: number;
  durationSec: number;
  fontSizePx: number;
  lineHeightPx: number;
  rows: number;
  cols: number;
  /** One `<pre class="glyph-output">` holding every frame, `rows` lines each. */
  html: string;
  /** The shared colour classes. */
  css: string;
}

function bakeTurntable(polygons: Polygon[], options: GlyphFramesExportOptions): Turntable {
  const N = Math.max(2, Math.floor(options.frameCount ?? 36));
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;
  const fsPx = options.fontSizePx ?? 13;
  const centered = options.autoCenter ? recenterPolygons(polygons) : polygons;
  const ortho = options.projection === "orthographic";
  const baseRotY = options.rotY ?? 45;
  // A flat polygon list neither casts nor receives a shadow; only an object mesh opts in.
  const model = options.shadow
    ? { polygons: [], objects: [{ id: "model", bounds: polygonBounds(centered), meshes: [{ name: "model", polygons: centered, options: { castShadow: true, receiveShadow: true } }] }] }
    : { polygons: centered };

  const bake = (zoom: number | undefined): ReturnType<typeof cropGlyphFrames> => {
    const frameInners: string[] = [];
    for (let i = 0; i < N; i++) {
      const rotY = baseRotY + (i * 360) / N;
      const camera = ortho
        ? createGlyphOrthographicCamera({ rotX: options.rotX, rotY, zoom })
        : createGlyphPerspectiveCamera({ rotX: options.rotX, rotY, zoom, perspective: options.perspectivePx });
      const { inner } = compileScene({
        ...model, camera, cols, rows,
        cellAspect: options.cellAspect, mode: options.mode,
        glyphPalette: options.glyphPalette, useColors: options.useColors,
        directionalLight: options.directionalLight, ambientLight: options.ambientLight, shadow: options.shadow,
      });
      frameInners.push(inner);
    }
    // Crop all frames to one common content box so the model sits centered with no
    // empty margin (and every frame stays the same size).
    return cropGlyphFrames(frameInners);
  };

  let cropped: ReturnType<typeof cropGlyphFrames>;
  if (options.fit) {
    // The crop box is the union of every frame's ink, so its size against the
    // grid gives the zoom correction directly. Perspective is not linear in
    // zoom and a clipped model under-reports its size, hence the passes.
    const { min, max } = polygonBounds(centered);
    let zoom = options.zoom ?? 200 / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9);
    cropped = bake(zoom);
    for (let pass = 0; pass < 3 && cropped.cols > 0; pass++) {
      const scale = Math.min((cols - 2) / cropped.cols, (rows - 2) / cropped.rows);
      // Stop once it fits with little room to spare; never settle on an overflow.
      if (scale >= 1 && scale < 1.03) break;
      zoom *= scale;
      cropped = bake(zoom);
    }
  } else {
    cropped = bake(options.zoom);
  }
  // Color classes dedupe across every frame so the palette is written once.
  const enc = encodeStaticGlyphHtml(cropped.frames.join("\n"), "classes");
  return {
    frameCount: N, durationSec: options.durationSec ?? 8,
    fontSizePx: fsPx, lineHeightPx: options.lineHeightPx ?? fsPx,
    rows: cropped.rows, cols: cropped.cols, html: enc.html, css: enc.css,
  };
}

/** Splits the baked `<pre>` into one `<pre>` per frame, each opened by `open(i)`. */
function splitFrames(t: Turntable, open: (i: number, tag: string) => string): string[] {
  const tag = t.html.slice(0, t.html.indexOf(">") + 1);
  const lines = t.html.slice(tag.length, -"</pre>".length).split("\n");
  return Array.from({ length: t.frameCount }, (_, i) => `${open(i, tag)}${lines.slice(i * t.rows, (i + 1) * t.rows).join("\n")}</pre>`);
}

export function buildGlyphFramesExport(
  polygons: Polygon[],
  options: GlyphFramesExportOptions = {},
): GlyphFramesExportResult {
  const t = bakeTurntable(polygons, options);
  const N = t.frameCount;
  const frameH = t.rows * t.lineHeightPx;
  const page = "html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}";
  const pre = `margin:0;white-space:pre;font-family:${FONT};font-size:${t.fontSizePx}px;line-height:${t.lineHeightPx}px`;

  if (options.layout === "stack") {
    // Every frame runs the same one-frame-long window, started one frame later
    // than the one before; the first is visible without the animation, so the
    // export never rests blank. `visibility`, not `opacity`: an opacity
    // animation gives every frame its own compositor layer.
    const css = `${page}
.glyph-roll{display:grid;height:${frameH}px}
.glyph-roll .glyph-output{grid-area:1/1;${pre};visibility:hidden;animation:glyph-frame ${t.durationSec}s step-end infinite}
.glyph-roll .glyph-output:first-child{visibility:visible}
@keyframes glyph-frame{0%{visibility:visible}${+(100 / N).toFixed(4)}%{visibility:hidden}}
${t.css}`;
    const frames = splitFrames(t, (i, tag) => (i ? `${tag.slice(0, -1)} style="animation-delay:${+((i * t.durationSec) / N).toFixed(4)}s">` : tag));
    const html = `<div class="glyph-roll">${frames.join("")}</div>`;
    return { html, pen: { html, css, js: "" }, frameCount: N };
  }

  const css = `${page}
.glyph-roll{height:${frameH}px;overflow:hidden}
.glyph-roll .glyph-output{${pre};animation:glyph-roll ${t.durationSec}s steps(${N}) infinite}
@keyframes glyph-roll{from{transform:translateY(0)}to{transform:translateY(-${N * frameH}px)}}
${t.css}`;
  const html = `<div class="glyph-roll">${t.html}</div>`;
  return { html, pen: { html, css, js: "" }, frameCount: N };
}

/**
 * The turntable as one self-animating SVG. A host that strips scripts and
 * styles from markup (GitHub, npm) still plays it, because an SVG shown as an
 * image keeps its own stylesheet and its SMIL timing. As an image it cannot
 * react to the reader, and its text is not selectable.
 *
 * `cellAspect` defaults to the cell the SVG really draws (line height over
 * the font's advance), not `compileScene`'s 2:1.
 */
export function buildGlyphFramesSvgExport(
  polygons: Polygon[],
  options: GlyphFramesSvgExportOptions = {},
): GlyphFramesSvgExportResult {
  const fsPx = options.fontSizePx ?? 13;
  const lhPx = options.lineHeightPx ?? fsPx;
  const t = bakeTurntable(polygons, { ...options, cellAspect: options.cellAspect ?? lhPx / (fsPx * 0.6) });
  const N = t.frameCount;
  const width = Math.ceil(t.cols * fsPx * SVG_ADVANCE);
  const height = t.rows * lhPx;
  const at = (i: number): string => `${+(i / N).toFixed(5)}`;
  // SMIL switches `display` on a <g> per frame. Hidden frames leave the render
  // tree, and nothing ticks per frame between switches; one CSS animation per
  // frame costs about four times the main-thread work. `display` animated on
  // the <foreignObject> itself does not repaint in Firefox.
  const frames = splitFrames(t, (_, tag) => `${tag.slice(0, -1)} xmlns="http://www.w3.org/1999/xhtml">`).map((frame, i) => {
    const timing = i === 0
      ? `values="inline;none" keyTimes="0;${at(1)}"`
      : `values="none;inline;none" keyTimes="0;${at(i)};${i === N - 1 ? "0.99999" : at(i + 1)}"`;
    return `<g display="${i ? "none" : "inline"}"><animate attributeName="display" calcMode="discrete" dur="${t.durationSec}s" repeatCount="indefinite" ${timing}/>` +
      `<foreignObject width="${width}" height="${height}">${frame}</foreignObject></g>`;
  });
  const css = `.glyph-output{margin:0;white-space:pre;font-family:${FONT};font-size:${fsPx}px;line-height:${lhPx}px}${t.css}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${css}</style>${frames.join("")}</svg>`;
  return { svg, width, height, frameCount: N };
}

function polygonBounds(polygons: Polygon[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, vertex[axis]!);
        max[axis] = Math.max(max[axis]!, vertex[axis]!);
      }
    }
  }
  return { min, max };
}
