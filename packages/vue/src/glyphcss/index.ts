// ── Scene ───────────────────────────────────────────────────────────────────
export { GlyphcssScene, GlyphcssMesh, GlyphcssGround, GlyphcssHotspot, GlyphcssSceneContextKey, useGlyphcssSceneContext, findGlyphcssMeshHandle, pointInMeshElement, findMeshUnderPoint } from "./scene";
export type {
  GlyphcssSceneProps,
  GlyphcssMeshProps,
  GlyphcssGroundProps,
  GlyphcssHotspotProps,
  GlyphcssSceneContextValue,
} from "./scene";

// ── Camera ──────────────────────────────────────────────────────────────────
export { GlyphcssCamera, GlyphcssPerspectiveCamera, GlyphcssOrthographicCamera, GlyphcssCameraContextKey, useGlyphcssCamera } from "./camera";
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
export type { UseGlyphcssAnimationResultVue } from "./animation/useGlyphcssAnimation";
