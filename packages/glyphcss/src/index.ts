/**
 * glyphcss — ASCII paint backend with polycss's scene-composition API.
 *
 * Public surface:
 *   - `createGlyphcssScene(host, options)` — imperative scene API
 *   - Camera factories — `createGlyphcssPerspectiveCamera`, `createGlyphcssOrthographicCamera`,
 *     `createGlyphcssFirstPersonCamera`
 *   - Controls — `createGlyphcssOrbitControls`, `createGlyphcssMapControls`,
 *     `createGlyphcssFirstPersonControls`
 *   - Rasterizer — `rasterize`, `bakeFrames`
 *   - Custom element classes (importing this entry does NOT auto-register them;
 *     use `glyphcss/elements` for that side effect).
 *   - Re-exports everything from `@glyphcss/core`.
 */

// ── Imperative scene API ──────────────────────────────────────────
export { createGlyphcssScene } from "./api/createGlyphcssScene";
export type {
  GlyphcssSceneHandle,
  GlyphcssMeshHandle,
  GlyphcssMeshTransform,
  GlyphcssSceneOptions,
  GlyphcssHotspotOptions,
  GlyphcssHotspotHandle,
} from "./api/createGlyphcssScene";

// Re-export glyphcss-specific types
export type { GlyphcssDirectionalLight, GlyphcssAmbientLight, GlyphcssTriangle } from "./api/types";

// ── Camera factories ──────────────────────────────────────────────
export {
  createGlyphcssPerspectiveCamera,
  createGlyphcssOrthographicCamera,
  createGlyphcssFirstPersonCamera,
} from "./api/createGlyphcssCamera";
export type {
  GlyphcssCamera,
  GlyphcssPerspectiveCameraOptions,
  GlyphcssOrthographicCameraOptions,
  GlyphcssFirstPersonCameraOptions,
  GlyphcssPerspectiveCameraHandle,
  GlyphcssOrthographicCameraHandle,
  GlyphcssFirstPersonCameraHandle,
} from "./api/createGlyphcssCamera";

// ── Controls ──────────────────────────────────────────────────────
export { createGlyphcssOrbitControls } from "./api/createGlyphcssOrbitControls";
export type {
  GlyphcssOrbitControlsOptions,
  GlyphcssOrbitControlsHandle,
} from "./api/createGlyphcssOrbitControls";

export { createGlyphcssMapControls } from "./api/createGlyphcssMapControls";
export type {
  GlyphcssMapControlsOptions,
  GlyphcssMapControlsHandle,
} from "./api/createGlyphcssMapControls";

export { createGlyphcssFirstPersonControls } from "./api/createGlyphcssFirstPersonControls";
export type {
  GlyphcssFirstPersonControlsOptions,
  GlyphcssFirstPersonControlsHandle,
} from "./api/createGlyphcssFirstPersonControls";

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
export { injectGlyphcssBaseStyles } from "./styles/styles";

// ── Custom element classes (without auto-registering) ─────────────
export { GlyphcssSceneElement } from "./elements/GlyphcssSceneElement";
export { GlyphcssMeshElement } from "./elements/GlyphcssMeshElement";
export { GlyphcssHotspotElement } from "./elements/GlyphcssHotspotElement";
export { GlyphcssPerspectiveCameraElement } from "./elements/GlyphcssPerspectiveCameraElement";
export { GlyphcssOrthographicCameraElement } from "./elements/GlyphcssOrthographicCameraElement";
export { GlyphcssOrbitControlsElement } from "./elements/GlyphcssOrbitControlsElement";
export { GlyphcssMapControlsElement } from "./elements/GlyphcssMapControlsElement";

// ── Re-exports from @glyphcss/core ───────────────────────────────
export * from "@glyphcss/core";
