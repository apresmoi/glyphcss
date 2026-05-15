/**
 * polycss — vanilla / custom-elements / imperative entry point.
 *
 * Public surface:
 *   - `createPolyScene(host, options)` — imperative scene API
 *   - `PolySceneElement`, `PolyMeshElement`, `PolyPolygonElement` —
 *     custom element classes (importing this entry does NOT auto-register
 *     them; use `@layoutit/polycss/elements` for that side effect).
 *   - Re-exports everything from `@layoutit/polycss-core` so vanilla users only
 *     need `npm install @layoutit/polycss`.
 */

// ── Imperative scene API ──────────────────────────────────────────
export { createPolyScene } from "./api/createPolyScene";
export type {
  PolySceneHandle,
  PolyMeshHandle,
  PolyMeshTransform,
  PolySceneOptions,
} from "./api/createPolyScene";

// ── Camera factories ──────────────────────────────────────────────
export { createPolyPerspectiveCamera, createPolyOrthographicCamera } from "./api/createPolyCamera";
export type {
  PolyCameraOptions,
  PolyPerspectiveCameraOptions,
  PolyOrthographicCameraOptions,
  PolyPerspectiveCameraHandle,
  PolyOrthographicCameraHandle,
} from "./api/createPolyCamera";

// ── Camera input (additive, optional layers) ──────────────────────
export { createPolyOrbitControls } from "./api/createPolyOrbitControls";
export type {
  PolyOrbitControlsOptions,
  PolyOrbitControlsHandle,
} from "./api/createPolyOrbitControls";

export { createPolyMapControls } from "./api/createPolyMapControls";
export type {
  PolyMapControlsOptions,
  PolyMapControlsHandle,
} from "./api/createPolyMapControls";

export type {
  PolyControlsHandle,
  PolyControlsBaseOptions,
  PolyControlsAnimateOptions,
  PolyControlsCamera,
  PolyControlsChangeEvent,
  PolyControlsInteractionEvent,
  PolyControlsEvent,
  PolyControlsListener,
} from "./api/controls/common";

// ── Mesh selection (additive, optional layer) ─────────────────────
export { createSelect } from "./api/createSelect";
export type { PolySelectOptions, PolySelectionHandle } from "./api/createSelect";

// ── Transform gizmo (additive, optional layer) ────────────────────
export { createTransformControls } from "./api/createTransformControls";
export type {
  PolyTransformControlsOptions,
  PolyTransformControlsHandle,
  PolyTransformControlsObjectChangeEvent,
} from "./api/createTransformControls";

// ── Custom element classes (without auto-registering — that's @layoutit/polycss/elements) ──
export { PolySceneElement } from "./elements/PolySceneElement";
export { PolyMeshElement } from "./elements/PolyMeshElement";
export { PolyPolygonElement } from "./elements/PolyPolygonElement";
export { PolyOrbitControlsElement } from "./elements/PolyOrbitControlsElement";
export { PolyMapControlsElement } from "./elements/PolyMapControlsElement";
export { PolyPerspectiveCameraElement } from "./elements/PolyPerspectiveCameraElement";
export { PolyOrthographicCameraElement } from "./elements/PolyOrthographicCameraElement";
export { PolyTransformControlsElement } from "./elements/PolyTransformControlsElement";
export { PolySelectElement } from "./elements/PolySelectElement";

// ── Render strategy options ───────────────────────────────────────
export type { PolyRenderStrategy, PolyRenderStrategiesOption, TextureQuality } from "./render/textureAtlas";

// ── Style injection ───────────────────────────────────────────────
export { injectPolyBaseStyles } from "./styles/styles";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────
export * from "@layoutit/polycss-core";
