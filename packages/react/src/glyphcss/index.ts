// ── Scene ───────────────────────────────────────────────────────────────────
export { GlyphcssScene, GlyphcssMesh, GlyphcssGround, GlyphcssHotspot, GlyphcssSceneContext, useGlyphcssSceneContext, useGlyphcssMesh, findGlyphcssMeshHandle, pointInMeshElement, findMeshUnderPoint } from "./scene";
export type {
  GlyphcssSceneProps,
  GlyphcssMeshProps,
  GlyphcssGroundProps,
  GlyphcssHotspotProps,
  GlyphcssSceneContextValue,
  UseGlyphcssMeshResult,
  UseGlyphcssMeshOptions,
} from "./scene";

// ── Camera ──────────────────────────────────────────────────────────────────
export { GlyphcssCamera, GlyphcssPerspectiveCamera, GlyphcssOrthographicCamera, GlyphcssCameraContext, useGlyphcssCamera } from "./camera";
export type {
  GlyphcssCameraProps,
  GlyphcssPerspectiveCameraProps,
  GlyphcssOrthographicCameraProps,
  GlyphcssCameraContextValue,
} from "./camera";

// ── Controls ────────────────────────────────────────────────────────────────
export { GlyphcssOrbitControls, GlyphcssMapControls, GlyphcssFirstPersonControls } from "./controls";
export type {
  GlyphcssOrbitControlsProps,
  GlyphcssMapControlsProps,
  GlyphcssFirstPersonControlsProps,
} from "./controls";

// ── Helpers ─────────────────────────────────────────────────────────────────
export { GlyphcssAxesHelper, GlyphcssDirectionalLightHelper } from "./helpers";
export type {
  GlyphcssAxesHelperProps,
  GlyphcssDirectionalLightHelperProps,
} from "./helpers";

// ── Styles ──────────────────────────────────────────────────────────────────
export { injectGlyphcssBaseStyles } from "./styles";

// ── Animation ───────────────────────────────────────────────────────────────
export { useGlyphcssAnimation } from "./animation/useGlyphcssAnimation";
export type { UseGlyphcssAnimationResult } from "./animation/useGlyphcssAnimation";
