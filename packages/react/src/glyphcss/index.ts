// ── Scene ───────────────────────────────────────────────────────────────────
export { GlyphScene, GlyphMesh, GlyphGround, GlyphHotspot, GlyphSceneContext, useGlyphSceneContext, useGlyphMesh, findGlyphMeshHandle, pointInMeshElement, findMeshUnderPoint } from "./scene";
export type {
  GlyphSceneProps,
  GlyphMeshProps,
  GlyphGroundProps,
  GlyphHotspotProps,
  GlyphSceneContextValue,
  UseGlyphMeshResult,
  UseGlyphMeshOptions,
} from "./scene";

// ── Camera ──────────────────────────────────────────────────────────────────
export { GlyphCamera, GlyphPerspectiveCamera, GlyphOrthographicCamera, GlyphCameraContext, useGlyphCamera } from "./camera";
export type {
  GlyphCameraProps,
  GlyphPerspectiveCameraProps,
  GlyphOrthographicCameraProps,
  GlyphCameraContextValue,
} from "./camera";

// ── Controls ────────────────────────────────────────────────────────────────
export { GlyphOrbitControls, GlyphMapControls, GlyphFirstPersonControls } from "./controls";
export type {
  GlyphOrbitControlsProps,
  GlyphMapControlsProps,
  GlyphFirstPersonControlsProps,
} from "./controls";

// ── Helpers ─────────────────────────────────────────────────────────────────
export { GlyphAxesHelper, GlyphDirectionalLightHelper } from "./helpers";
export type {
  GlyphAxesHelperProps,
  GlyphDirectionalLightHelperProps,
} from "./helpers";

// ── Styles ──────────────────────────────────────────────────────────────────
export { injectGlyphBaseStyles } from "./styles";

// ── Animation ───────────────────────────────────────────────────────────────
export { useGlyphAnimation } from "./animation/useGlyphAnimation";
export type { UseGlyphAnimationResult } from "./animation/useGlyphAnimation";
