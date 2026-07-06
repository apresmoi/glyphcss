/**
 * glyphcss — ASCII paint backend with glyphcss's scene-composition API.
 *
 * Public surface:
 *   - `createGlyphScene(host, options)` — imperative scene API
 *   - Camera factories — `createGlyphCamera` (ortho alias), `createGlyphPerspectiveCamera`,
 *     `createGlyphOrthographicCamera`
 *   - Controls — `createGlyphOrbitControls`, `createGlyphMapControls`,
 *     `createGlyphFirstPersonControls`
 *   - Rasterizer — `rasterize`, `bakeFrames`
 *   - Custom element classes (importing this entry does NOT auto-register them;
 *     use `glyphcss/elements` for that side effect).
 *   - Re-exports everything from `@glyphcss/core`.
 */

// ── Imperative scene API ──────────────────────────────────────────
export { createGlyphScene } from "./api/createGlyphScene";
export type {
  GlyphSceneHandle,
  GlyphMeshHandle,
  GlyphMeshTransform,
  GlyphSceneOptions,
  GlyphHotspotOptions,
  GlyphHotspotHandle,
  GlyphShadowOptions,
} from "./api/createGlyphScene";

// Static compile — render a scene to its `<pre>` without a DOM (build-time / SSR).
export { compileScene } from "./api/compileScene";
export type { CompileSceneOptions, CompileSceneResult } from "./api/compileScene";

// Static encoding — re-encode a rendered colored `<pre>` into a compacter static
// form (color classes / CSS-grid placement) for zero-runtime artifacts.
export { encodeStaticGlyphHtml, cropGlyphInner, encodeGlyphAnsi } from "./api/staticEncode";
export type { GlyphStaticEncoding, EncodeStaticResult } from "./api/staticEncode";

// Frames export — bake a turntable of ASCII frames + a pure-CSS steps() loop:
// zero-runtime rotating ASCII, no mesh, no glyphcss shipped. Pure / browser-safe.
export { buildGlyphFramesExport } from "./api/framesExport";
export type { GlyphFramesExportOptions, GlyphFramesExportResult } from "./api/framesExport";

// Interactive export — polygons + declared interactions → a portable, decimated,
// self-contained glyphcss snippet (CDN + inlined mesh). Pure / browser-safe.
export { buildGlyphInteractiveExport, glyphCodepenPrefill } from "./api/interactiveExport";
export type {
  GlyphInteraction,
  GlyphInteractiveExportOptions,
  GlyphInteractiveExportResult,
} from "./api/interactiveExport";

// Re-export glyph-specific types
export type { GlyphDirectionalLight, GlyphAmbientLight } from "./api/types";

// ── Camera factories ──────────────────────────────────────────────
export {
  createGlyphCamera,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  DEFAULT_PERSPECTIVE,
} from "./api/createGlyphCamera";
export type {
  GlyphCamera,
  GlyphPerspectiveCameraOptions,
  GlyphOrthographicCameraOptions,
  GlyphPerspectiveCameraHandle,
  GlyphOrthographicCameraHandle,
} from "./api/createGlyphCamera";

// ── Controls ──────────────────────────────────────────────────────
export { createGlyphOrbitControls } from "./api/createGlyphOrbitControls";
export type {
  GlyphOrbitControlsOptions,
  GlyphOrbitControlsHandle,
} from "./api/createGlyphOrbitControls";

export { createGlyphMapControls } from "./api/createGlyphMapControls";
export type {
  GlyphMapControlsOptions,
  GlyphMapControlsHandle,
} from "./api/createGlyphMapControls";

export { createGlyphFirstPersonControls } from "./api/createGlyphFirstPersonControls";
export type {
  GlyphFirstPersonControlsOptions,
  GlyphFirstPersonControlsHandle,
} from "./api/createGlyphFirstPersonControls";

// Shared controls event surface (change / start / end), exposed on every
// control handle's addEventListener — parity with voxcss PolyControls* events.
export type {
  GlyphControlsCamera,
  GlyphControlsChangeEvent,
  GlyphControlsInteractionEvent,
  GlyphControlsEvent,
  GlyphControlsListener,
  GlyphControlsEventTarget,
} from "./api/controls/common";

// ── Mesh finders ──────────────────────────────────────────────────
export { findGlyphMeshHandle, findMeshUnderPoint, pointInMeshElement } from "./api/meshFinders";

// ── Event types ───────────────────────────────────────────────────
export type {
  GlyphPointerEvent,
  GlyphMouseEvent,
  GlyphWheelEvent,
  GlyphEventHandler,
} from "./api/events";

// ── Hotspot projection (hit layer) ────────────────────────────────
export { projectHotspots } from "./api/projectHotspots";

// ── Rasterizer ────────────────────────────────────────────────────
export { rasterize, bakeFrames, rasterizeToCells } from "./render/rasterize";
// ── Cell-buffer contract + post-rasterize hook (M4 composition effects) ──
export { buildCellGrid, applyCellHook } from "./render/cells";
export type { CellGrid, TransformCells } from "./render/cells";
export {
  DEFAULT_RAMP,
  SOLID_RAMP,
  WIREFRAME_GLYPHS,
  WIREFRAME_PALETTES,
  getWireframeGlyphs,
} from "./render/ramps";
export type { WireframeGlyphTiers } from "./render/ramps";

// ── RasterizeContext ──────────────────────────────────────────────
export { buildRasterizeContext } from "./api/rasterizeContext";
export type {
  RasterizeContext,
  RasterizeContextOptions,
} from "./api/rasterizeContext";

// ── Style injection ───────────────────────────────────────────────
export { injectGlyphBaseStyles } from "./styles/styles";

// ── Custom element classes (without auto-registering) ─────────────
export { GlyphSceneElement } from "./elements/GlyphSceneElement";
export { GlyphMeshElement } from "./elements/GlyphMeshElement";
export { GlyphHotspotElement } from "./elements/GlyphHotspotElement";
export { GlyphPerspectiveCameraElement } from "./elements/GlyphPerspectiveCameraElement";
export { GlyphOrthographicCameraElement } from "./elements/GlyphOrthographicCameraElement";
export { GlyphOrbitControlsElement } from "./elements/GlyphOrbitControlsElement";
export { GlyphMapControlsElement } from "./elements/GlyphMapControlsElement";

// ── Re-exports from @glyphcss/core ───────────────────────────────
export * from "@glyphcss/core";
