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
  GlyphSemanticCellFrame,
  GlyphSemanticCellLineage,
  GlyphHotspotOptions,
  GlyphHotspotHandle,
  GlyphShadowOptions,
} from "./api/createGlyphScene";

// Effect-program protocol + scene-root compositor layers.
export * from "./api/effects";

// Retained-effect base frame — turns a rasterized `CellGrid` (with optional
// shade/worldPosition/normal buffers) into the `GlyphEffectFrameView` +
// coverage shape an effect program's `evaluate()` reads. Exposed so a
// build-time exporter (e.g. `@glyphcss/effects`'s static field-synth export)
// can bake the SAME per-cell inputs a mounted effect layer sees, instead of
// re-deriving coverage/color-packing from a `CellGrid` by hand.
export { retainGlyphEffectOutput } from "./render/effectCompositor";
export type {
  GlyphEffectOutputMetadata,
  RetainedGlyphEffectOutput,
} from "./render/effectCompositor";

// Static compile — render a scene to its `<pre>` without a DOM (build-time / SSR).
export { compileScene } from "./api/compileScene";
export type { CompileSceneOptions, CompileSceneResult } from "./api/compileScene";

// Pure semantic/control capture — one real solid rasterization with an optional
// winner-polygon buffer, for browser-safe dataset and reprojection consumers.
export { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, resolveGlyphControlLineage, validateGlyphControlMetadata } from "./api/controlFrame";
export type {
  GlyphObjectDictionary,
  GlyphObjectDictionaryClass,
  GlyphControlSceneManifest,
  GlyphControlInstance,
  GlyphControlSurface,
  GlyphControlFrameOptions,
  GlyphControlFrameMetadata,
  GlyphControlCameraMetadata,
  GlyphControlFrame,
  GlyphControlGeometryHashes,
  GlyphControlPolygonLineage,
} from "./api/controlFrame";

// Frozen model-facing control tensor contract. This deliberately excludes raw
// polygon/class/instance/surface identifiers; those remain atlas-routing data.
export { GLYPH_CONTROL_TENSOR_CONTRACT, packGlyphControlTensor, validateGlyphControlTensorSpec } from "./api/controlTensor";
export type {
  GlyphControlTensorChannelSource,
  GlyphControlTensorChannel,
  GlyphControlTensorContract,
  GlyphControlTensorInstance,
  GlyphControlTensorSpec,
  GlyphControlTensorNormalization,
  GlyphTemporalControlInputs,
  GlyphPackedControlTensors,
} from "./api/controlTensor";

// Deterministic, surface-addressed temporal presentation. This is pure and
// browser-safe: it consumes control frames and accepted RGB, never the DOM.
export { reprojectGlyphSurfaceAtlas, resampleGlyphTemporalInputs } from "./api/reprojectSurfaceAtlas";
export type {
  GlyphSurfaceAtlasState,
  GlyphSurfaceAtlasProvenance,
  GlyphSurfaceAtlasCamera,
  GlyphSurfaceAtlasSurface,
  GlyphReprojectSurfaceAtlasOptions,
  GlyphReprojectSurfaceAtlasResult,
} from "./api/reprojectSurfaceAtlas";

// Browser-only GPU presentation counterpart. The CPU atlas remains the public
// deterministic oracle and checkpoint format; this session never touches the
// renderer's `<pre>` surface.
export { createGlyphSurfaceAtlasWebGpuSession } from "./api/reprojectSurfaceAtlasWebGpu";
export type {
  GlyphSurfaceAtlasWebGpuSession,
  GlyphSurfaceAtlasWebGpuSessionOptions,
  GlyphSurfaceAtlasWebGpuSubmitOptions,
  GlyphSurfaceAtlasWebGpuReadback,
  GlyphSurfaceAtlasWebGpuPresentationReadback,
  GlyphSurfaceAtlasWebGpuProfile,
} from "./api/reprojectSurfaceAtlasWebGpu";

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
export type { GlyphDirectionalLight, GlyphAmbientLight, GlyphSolidWeightRampStep } from "./api/types";

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
export {
  buildCellGrid,
  cloneCellGrid,
  encodeGlyphBuffers,
  encodeGlyphBuffersDual,
  encodeCellGrid,
  encodeCellGridOutput,
  encodeGlyphAtlas,
  encodeCellGridAtlas,
  isGlyphAtlasEncodable,
  applyCellHook,
} from "./render/cells";
export type { CellGrid, TransformCells, GlyphColorEncoding } from "./render/cells";
// ── Colour-font atlas (`colorEncoding: "atlas"` foundation) ──────────────
export {
  GLYPH_FONT_ATLAS,
  isGlyphInFontAtlas,
  glyphAtlasCodePoint,
  decodeGlyphAtlasCodePoint,
  decodeGlyphAtlasText,
  buildGlyphAtlasFontFaceCss,
  buildGlyphAtlasFontPaletteValuesCss,
} from "./render/fontAtlas";
export type { GlyphFontAtlas } from "./render/fontAtlas";
// ── Atlas palette quantization (the ≤31-slot reduction the atlas needs) ──
export {
  medianCutPalette,
  quantizeGlyphAtlasPalette,
  createGlyphAtlasPaletteQuantizer,
  histogramGridColors,
  nearestPaletteIndex,
  redmeanDistanceSq,
  packHexColor,
  unpackHexColor,
  isQuantizableColor,
  resolveGlyphAtlasPaletteInput,
} from "./render/paletteQuantize";
export type {
  GlyphAtlasPaletteInput,
  GlyphAtlasPaletteSource,
  GlyphAtlasPaletteQuantizer,
  GlyphAtlasPaletteQuantizerOptions,
} from "./render/paletteQuantize";
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
export { GlyphEffectLayerElement } from "./elements/GlyphEffectLayerElement";
export type { GlyphEffectLayerElementConfig } from "./elements/GlyphEffectLayerElement";

// ── Re-exports from @glyphcss/core ───────────────────────────────
export * from "@glyphcss/core";
