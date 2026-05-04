/**
 * Scene context — the top-level entry point that takes a polygon mesh
 * (already normalized) and returns the data the framework wrappers need
 * to render.
 *
 * Polycss inherits its name from voxcss but the shape is much smaller:
 * no cube grid, no per-Z layer bucketing, no wall mask, no neighbor-based
 * occlusion. Just a polygon list and a scene bbox.
 *
 * The wallMasksEqual helper survives because the camera + render store
 * still wants a way to compare scene-shape signatures (used as React
 * memo keys); the wall-mask part of voxcss is gone but the underlying
 * "two snapshots equal?" pattern is reused.
 */
import type { Polygon, ProjectionMode, Vec3 } from "../types";
import { DEFAULT_PROJECTION } from "../types";
import { normalizePolygons, type NormalizeResult } from "./normalize";

export interface SceneBbox {
  /** Minimum corner of the axis-aligned bounding box (inclusive). */
  min: Vec3;
  /** Maximum corner of the axis-aligned bounding box (inclusive). */
  max: Vec3;
}

export interface SceneContext {
  /** Validated polygon list — the renderer iterates this. */
  polygons: Polygon[];
  /** Polygon-mesh bbox in world space. Used to size the scene container. */
  sceneBbox: SceneBbox;
  /** Projection mode. */
  projection: ProjectionMode;
  /** Warnings raised during normalization (already-applied fixes). */
  warnings: string[];
}

export interface SceneContextBuildArgs {
  /**
   * Polygon list. Pass parser output directly — `buildSceneContext` runs
   * `normalizePolygons` for you.
   */
  polygons: Polygon[];
  /** Optional projection override. Defaults to "cubic". */
  projection?: ProjectionMode;
  /**
   * If true, skip the normalize pass (caller has already validated). Useful
   * when chaining `mergePolygons` after a manual `normalizePolygons` call.
   */
  skipNormalize?: boolean;
}

export interface SceneContextBuildResult {
  context: SceneContext;
  /**
   * Mesh-bbox dimensions. Convenience copy of `context.sceneBbox` plus a
   * `size` field (max - min) for callers that want a single number per axis.
   */
  dimensions: { sceneBbox: SceneBbox; size: Vec3 };
  /** Warnings raised during normalization. Mirrors `context.warnings`. */
  warnings: string[];
}

/**
 * Compute the axis-aligned bounding box across every vertex of every polygon.
 * Returns a zero-extent bbox at origin for empty input — callers that care
 * about that case should check `polygons.length` first.
 */
export function computeSceneBbox(polygons: Polygon[]): SceneBbox {
  if (!polygons || polygons.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const p of polygons) {
    if (!p?.vertices) continue;
    for (const v of p.vertices) {
      if (!v) continue;
      any = true;
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!any) return { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

export function buildSceneContext(args: SceneContextBuildArgs): SceneContextBuildResult {
  const input = args.polygons ?? [];
  let polygons: Polygon[];
  let warnings: string[];
  if (args.skipNormalize) {
    polygons = input;
    warnings = [];
  } else {
    const normalized: NormalizeResult = normalizePolygons(input);
    polygons = normalized.polygons;
    warnings = normalized.warnings;
  }

  const sceneBbox = computeSceneBbox(polygons);
  const size: Vec3 = [
    sceneBbox.max[0] - sceneBbox.min[0],
    sceneBbox.max[1] - sceneBbox.min[1],
    sceneBbox.max[2] - sceneBbox.min[2],
  ];

  const context: SceneContext = {
    polygons,
    sceneBbox,
    projection: args.projection ?? DEFAULT_PROJECTION,
    warnings,
  };

  return {
    context,
    dimensions: { sceneBbox, size },
    warnings,
  };
}

/**
 * Re-export `normalizePolygons` for callers that import scene/context as
 * the canonical scene-pipeline entry point.
 */
export { normalizePolygons };
export type { NormalizeResult };
