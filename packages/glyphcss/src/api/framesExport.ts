/**
 * buildGlyphFramesExport — bake a turntable of ASCII frames and emit a
 * self-contained, **zero-runtime** rotating export: no mesh, no glyphcss, just
 * pre-rendered text frames stacked into one `<pre>` and cycled with a pure-CSS
 * `steps()` animation.
 *
 * This is the "do better than shipping the mesh" path for orbit-class motion:
 * the reachable views (yaw angles) are a small discrete set, so we render them
 * ahead of time. Each frame is a full `compileScene` render, so colors are
 * faithful (per-face baked for textured meshes). Trade-offs: discrete angles
 * (smoothness ∝ frameCount), fixed resolution, and payload = frameCount × frame.
 */
import type { Polygon, RenderMode } from "@glyphcss/core";
import { recenterPolygons } from "@glyphcss/core";
import { compileScene } from "./compileScene";
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
  /** Rendered line-height in px (for exact frame height). Default = fontSizePx. */
  lineHeightPx?: number;
  fontSizePx?: number;
}

export interface GlyphFramesExportResult {
  html: string;
  pen: { html: string; css: string; js: string };
  frameCount: number;
}

export function buildGlyphFramesExport(
  polygons: Polygon[],
  options: GlyphFramesExportOptions = {},
): GlyphFramesExportResult {
  const N = Math.max(2, Math.floor(options.frameCount ?? 36));
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;
  const dur = options.durationSec ?? 8;
  const fsPx = options.fontSizePx ?? 13;
  const lhPx = options.lineHeightPx ?? fsPx;
  const centered = options.autoCenter ? recenterPolygons(polygons) : polygons;
  const ortho = options.projection === "orthographic";
  const baseRotY = options.rotY ?? 45;

  const frameInners: string[] = [];
  for (let i = 0; i < N; i++) {
    const rotY = baseRotY + (i * 360) / N;
    const camera = ortho
      ? createGlyphOrthographicCamera({ rotX: options.rotX, rotY, zoom: options.zoom })
      : createGlyphPerspectiveCamera({ rotX: options.rotX, rotY, zoom: options.zoom, perspective: options.perspectivePx });
    const { inner } = compileScene({
      polygons: centered, camera, cols, rows,
      cellAspect: options.cellAspect, mode: options.mode,
      glyphPalette: options.glyphPalette, useColors: options.useColors,
    });
    frameInners.push(inner);
  }

  // Crop all frames to one common content box so the model sits centered with no
  // empty margin (and every frame stays the same size). Then stack into one
  // <pre>; color classes dedupe across every frame so the palette is written once.
  const cropped = cropGlyphFrames(frameInners);
  const enc = encodeStaticGlyphHtml(cropped.frames.join("\n"), "classes");
  const frameH = cropped.rows * lhPx;
  const totalShift = N * frameH;
  const css = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
.glyph-roll{height:${frameH}px;overflow:hidden}
.glyph-roll .glyph-output{margin:0;white-space:pre;font-family:ui-monospace,Menlo,monospace;font-size:${fsPx}px;line-height:${lhPx}px;animation:glyph-roll ${dur}s steps(${N}) infinite}
@keyframes glyph-roll{from{transform:translateY(0)}to{transform:translateY(-${totalShift}px)}}
${enc.css}`;
  const html = `<div class="glyph-roll">${enc.html}</div>`;
  return { html, pen: { html, css, js: "" }, frameCount: N };
}
