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
  SceneHandle,
  MeshHandle,
  MeshTransform,
  PolySceneOptions,
} from "./api/createPolyScene";

// ── Camera input + autorotate (additive, optional layer) ──────────
export { createPolyControls } from "./api/createPolyControls";
export type {
  ControlsHandle,
  PolyControlsOptions,
  PolyControlsAnimateOptions,
} from "./api/createPolyControls";

// ── Mesh selection (additive, optional layer) ─────────────────────
export { createSelect } from "./api/createSelect";
export type { CreateSelectOptions, SelectionHandle } from "./api/createSelect";

// ── Transform gizmo (additive, optional layer) ────────────────────
export { createTransformControls } from "./api/createTransformControls";
export type {
  CreateTransformControlsOptions,
  TransformControlsHandle,
  TransformControlsObjectChangeEvent,
} from "./api/createTransformControls";

// ── Custom element classes (without auto-registering — that's @layoutit/polycss/elements) ──
export { PolySceneElement } from "./elements/PolySceneElement";
export { PolyMeshElement } from "./elements/PolyMeshElement";
export { PolyPolygonElement } from "./elements/PolyPolygonElement";
export { PolyControlsElement } from "./elements/PolyControlsElement";

// ── Style injection ───────────────────────────────────────────────
export { injectBaseStyles } from "./styles/styles";

// ── Re-exports from @layoutit/polycss-core ─────────────────────────────────
export * from "@layoutit/polycss-core";
