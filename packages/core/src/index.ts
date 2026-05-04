// @polycss/core — Pure-math polygon rendering engine (zero browser globals).
//
// Public surface follows the API freeze in POLYCSS_MIGRATION.md §1543.
// Anything not exported here is implementation detail.

// ── Types ─────────────────────────────────────────────────────────
export type {
  Vec2,
  Vec3,
  Polygon,
  DirectionalLight,
  ProjectionMode,
} from "./types";
export { DEFAULT_PROJECTION } from "./types";

// ── Scene context + normalization ────────────────────────────────
export {
  buildSceneContext,
  computeSceneBbox,
  normalizePolygons,
} from "./scene/context";
export type {
  SceneContext,
  SceneContextBuildArgs,
  SceneContextBuildResult,
  SceneBbox,
  NormalizeResult,
} from "./scene/context";

// ── Polygon geometry helper ──────────────────────────────────────
export { polygonFaces } from "./scene/polygonGeometry";
export type { PolygonFace } from "./scene/polygonGeometry";

// ── Direction binning (camera quantization, used for back-face culling) ─
export {
  directionBinFromCamera,
  directionVectorFromBin,
  OCCLUSION_DIR_BINS,
  AZIMUTH_BINS,
  ELEVATION_BINS,
} from "./scene/occlusionDirection";

// ── Camera ────────────────────────────────────────────────────────
export {
  createIsometricCamera,
  normalizeInvertMultiplier,
  DEFAULT_CAMERA_STATE,
} from "./camera/camera";
export type {
  CameraState,
  CameraHandle,
  AutoRotateOption,
  AutoRotateConfig,
  CameraStyleInput,
} from "./camera/camera";

// ── Color & lighting ─────────────────────────────────────────────
export {
  parseColor,
  shadeColor,
  computeShapeLighting,
} from "./color/lighting";
export type { ParsedColor } from "./color/lighting";

export {
  parsePureColor,
  parseHexColor,
  parseRgbColor,
  clampChannel,
  formatColor,
} from "./color/color";

// ── Mesh post-processing ──────────────────────────────────────────
export { mergePolygons } from "./merge/mergePolygons";

// ── Parsers ───────────────────────────────────────────────────────
export type { ParseResult } from "./parser/types";
export { parseObj } from "./parser/parseObj";
export type { ObjParseOptions } from "./parser/parseObj";
export { parseMtl } from "./parser/parseMtl";
export type { MtlParseResult } from "./parser/parseMtl";
export { parseGltf } from "./parser/parseGltf";
export type { GltfParseOptions } from "./parser/parseGltf";
export { parseVox } from "./parser/parseVox";
export type { VoxParseOptions } from "./parser/parseVox";
export { loadMesh } from "./parser/loadMesh";
export type { LoadMeshOptions } from "./parser/loadMesh";
