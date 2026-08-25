// Shared types for the gallery workbench. Keep this file lean — only the
// type declarations that flow between subfolders (presets/, helpers/, the
// component itself) live here. Component-internal types stay local.

import type { GltfParseOptions, ObjParseOptions, Polygon, StlParseOptions, VoxParseOptions } from "@glyphcss/core";
import type { GlyphEffectId } from "@glyphcss/effects";

export type ModelKind = "obj" | "glb" | "gltf" | "vox" | "stl" | "primitive";
export type GalleryBucket = "Solid" | "Textured" | "Animated" | "Voxel" | "Primitives" | "CAD";
export type PerspectiveMode = "perspective" | "orthographic";
export type DragMode = "orbit" | "pan" | "fpv";

export interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
}

interface BasePreset {
  id: string;
  label: string;
  category: string;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  options?: ObjParseOptions | GltfParseOptions | VoxParseOptions | StlParseOptions;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

interface UrlPreset extends BasePreset {
  kind: Exclude<ModelKind, "primitive">;
  url: string;
  mtlUrl?: string;
}

export interface PrimitivePreset extends BasePreset {
  kind: "primitive";
  url?: never;
  mtlUrl?: never;
  generatePolygons: () => Polygon[];
}

export type PresetModel = UrlPreset | PrimitivePreset;

export interface DroppedModelSource {
  id: string;
  label: string;
  kind: Exclude<ModelKind, "gltf">;
  primaryFile: File;
  files: File[];
  preset: PresetModel;
}

export interface GalleryPresetFile {
  file: string;
  label?: string;
  category: string;
  targetSize?: number;
  defaultColor?: string;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

export interface ObjGalleryPresetFile extends GalleryPresetFile {
  mtlFile?: string | null;
  options?: ObjParseOptions;
}

export interface StlGalleryPresetFile extends GalleryPresetFile {
  options?: StlParseOptions;
}

export interface GlyphMetrics {
  measuredAt: number;
  cols: number;
  rows: number;
  glyphs: number;
  textChars: number;
  colorSpans: number;
  domNodes: number;
  layers: number;
  bakeMs: number;
}

export type GalleryEffectParamValue = string | number | boolean;
export type GalleryEffectBlend = "replace" | "over";

/**
 * Shareable gallery state for one stock glyph effect. Procedural `time` is
 * deliberately absent: the runtime owns that high-frequency value while this
 * object carries only authoring and playback configuration.
 */
export interface GalleryEffectState {
  effectId: GlyphEffectId | null;
  effectVersion: number;
  blend: GalleryEffectBlend;
  paused: boolean;
  timeScale: number;
  params: Record<string, GalleryEffectParamValue>;
}

export interface SceneOptionsState {
  animationPaused: boolean;
  animationTimeScale: number;
  autoCenter: boolean;
  autoRotate: boolean;
  interactive: boolean;
  zoom: number;
  rotX: number;
  rotY: number;
  perspective: number | false;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  target: [number, number, number];
  renderMode: "wireframe" | "solid" | "ink";
  featureEdges: number;
  glyphPalette: "default" | "ascii" | "lines" | "blocks" | "stars" | "arrows" | "math" | "binary" | "hex" | "calibrated";
  /**
   * Character encoding for rasterized output. "braille" only affects
   * wireframe mode; "halfblock" and "quadrant" only affect solid mode.
   * "halfblock" packs top/bottom subcells into `▀`/`▄`/`█` for 2x vertical
   * color resolution; "quadrant" generalizes that to a full 2x2 subcell
   * split (16 possible glyphs) for both shape AND color resolution.
   */
  charMode: "ascii" | "braille" | "halfblock" | "quadrant";
  /** Box-drawing junction resolve pass (wireframe + charMode "ascii" only). */
  wireframeJunctions: boolean;
  /**
   * Hidden-line removal for the wireframe path (wireframe + charMode
   * "braille"). "show" is today's default; "hide" depth-tests strokes
   * against a solid surface prepass. No-op in solid mode (already
   * depth-buffered) and ink mode (not wired).
   */
  hiddenLines: "show" | "hide";
  /**
   * Solid-mode-only second density axis: font-weight-calibrated ramp toggle.
   * When on, the gallery calibrates a `(glyph, weight)[]` ramp for the active
   * font (via `@glyphcss/effects`'s `calibrateWeightedGlyphRamp`) and passes
   * it as the scene's `solidWeightRamp` option, so shading picks both a
   * glyph and a CSS `font-weight` — more perceptual steps than glyph shape
   * alone. No-op outside solid mode, and with `charMode: "halfblock"` or
   * `"quadrant"` (both two-color-per-cell encodings have no font-weight
   * span).
   */
  solidWeightRamp: boolean;
  /**
   * `glyphcss` scene option — `"spans"` (default) or `"atlas"` (zero-`<span>`
   * colour-font encoding, one PUA text node instead of one `<span>` per color
   * run). The atlas palette itself is never part of this state — `glyphcss`
   * derives and pools it internally from the real cell buffers.
   */
  colorEncoding: "spans" | "atlas";
  lineHeight: number;
  /** Scene-wide glyph density multiplier (1 = base). Drives the render font-size. */
  density: number;
  /** Linear glyph-density ratio used only while dragging (1 = full density). */
  dragDensity: number;
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  dragMode: DragMode;
  fpvLook: boolean;
  fpvMove: boolean;
  fpvJump: boolean;
  fpvCrouch: boolean;
  fpvMoveSpeed: number;
  fpvJumpVelocity: number;
  fpvGravity: number;
  fpvEyeHeight: number;
  fpvCrouchHeight: number;
  fpvLookSensitivity: number;
  fpvInvertY: boolean;
  // Shadow
  shadowEnabled: boolean;
  shadowOpacity: number;
  shadowLift: number;
  shadowColor: string;
  shadowCast: boolean;
  shadowReceive: boolean;
  shadowFloor: boolean;
}
