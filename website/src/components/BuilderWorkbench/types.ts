import type { Polygon, Vec3 } from "@layoutit/polycss-react";
import type { PresetModel } from "../GalleryWorkbench/types";
import type { Bbox } from "./geometry/ghost";

export interface PlacedItem {
  id: string;
  preset: PresetModel;
  /** Pre-optimization polygons from the parser. Stored so we can re-apply
   *  `optimizeMeshPolygons` + interior-fill at render time when the Dock's
   *  meshResolution / meshInteriorFill change without re-fetching the asset.
   *  `null` means the item is placed but its model hasn't been fetched yet —
   *  scene-preset items load lazily on proximity (see the lazy-load effect
   *  below). Pending items have placeholder `position` + `fitScale` until
   *  the load completes; they don't render. */
  rawPolygons: Polygon[] | null;
  position: Vec3;
  rotation: Vec3;
  /** User-facing scale multiplier. 1× = normalized-fit size. */
  scale: number;
  /** Per-mesh normalization factor so different presets render at similar size. */
  fitScale: number;
  /** World-space center of the placement (the bbox center after scale).
   *  Stored separately from `position` (which is in CSS-pixel space and
   *  carries the origin shift) so distance-based culling has a stable
   *  world-coord reference. Updated on placement and on gizmo drag. */
  worldX: number;
  worldY: number;
}

/** Transient state while the user is hovering a preset over the floor. */
export interface PlacementDraft {
  preset: PresetModel;
  rawPolygons: Polygon[];
  bbox: Bbox;
  /** meshBbox result — needed by placeMeshOnFloor at commit time. */
  meshBboxResult: { midX: number; midY: number; midZ: number; minZ: number };
  fitScale: number;
}

export type ToolMode = "pointer" | "raise" | "lower" | "smooth";

/** What a terrain-tool click targets. Independent of `ToolMode` so the
 *  user can raise/lower/smooth either a single grid VERTEX (deforms 4
 *  adjacent cells around it) or a whole FACE (deforms all 4 of its
 *  corners, creating a flat-top step). */
export type TargetMode = "vertex" | "face";
