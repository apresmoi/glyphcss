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
} from "./api/createGlyphScene";

// Re-export glyph-specific types
export type { GlyphDirectionalLight, GlyphAmbientLight } from "./api/types";

// ── Camera factories ──────────────────────────────────────────────
export {
  createGlyphCamera,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
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
export { rasterize, bakeFrames } from "./render/rasterize";
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
