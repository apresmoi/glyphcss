import type { Polygon, Vec2, Vec3, DirectionalLight } from "@polycss/core";

/**
 * TEMPORARY Phase-3.0 compatibility shim. Phase 2 deleted the old `Voxel`
 * type from @polycss/core (replaced by the unified `Polygon` type, which has
 * only `vertices/color/texture/uvs/data`). The React renderer still has cube-
 * era files (`VoxCube`, `Ramp`, `Wedge`, `Spike`, `VoxShape`, slice/, etc.)
 * that reference the cube fields (`x`, `y`, `z`, `shape`, `rot`, `path`,
 * `x2/y2/z2`). Phase 3 deletes those files; until then, this shim lets them
 * compile.
 *
 * The shape: `Polygon` (real fields) ∪ `{ ...optional cube-era fields }`.
 * After Phase 3 strips the cube components, this whole file collapses to
 * "Poly takes a Polygon" and the shim disappears.
 */
export interface Voxel extends Polygon {
  x?: number;
  y?: number;
  z?: number;
  x2?: number;
  y2?: number;
  z2?: number;
  shape?: string;
  rot?: number;
  path?: string;
}

/**
 * TEMPORARY shim — pre-polycss `GridContext`/`SceneContext` had a richer
 * surface used by the cube renderers. Phase 3 collapses callers to use
 * `SceneContext` from @polycss/core directly. Until then, every cube-era
 * field is optional so existing code compiles. Triangle.tsx only reads
 * `tileSize`, `layerElevation`, `directionalLight`, `debugShowBackfaces`.
 */
export interface GridContext {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: DirectionalLight;
  debugShowOccluded?: boolean;
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
  occlusionMap?: Map<string, string>;
  // Loose escape hatch: cube-era code reads many other fields on this
  // context that don't exist on SceneContext anymore. Phase 3 fixes the
  // call sites; for now, keep it permissive so the shim doesn't gate
  // unrelated work.
  [key: string]: unknown;
}

/**
 * TEMPORARY shim — pre-polycss per-surface lighting record used by the
 * cube renderers (top/front/left/etc. each get their own shaded color).
 * `Polygon` doesn't need this (one face = one shaded color), but cube-era
 * files still expect the type. Phase 3 deletes the consumers.
 */
export interface ShapeSurfaceLighting {
  id: string;
  color: string;
  delta: number;
}

export interface ShapeInnerProps {
  voxel: Voxel;
  context: GridContext;
  baseColor: string;
  lighting: ShapeSurfaceLighting[];
  showBottom: boolean;
}
