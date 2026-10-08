/**
 * `GlyphSceneObject` — the generic composition primitive (PLAN-3d.md §3.1).
 *
 * A producer (a 3D chart, a 3D diagram, or any hand-built scene fragment)
 * returns one of these: a bundle of named meshes, optional in-grid overlays
 * (axes, edges, labels — anything that needs to be stamped into the cell
 * grid AFTER rasterization), optional DOM hotspots, and optional texture
 * samplers. `scene.addObject(object, transform)` mounts it into any
 * `createGlyphScene` — the object never sees the host scene's camera, light,
 * or other objects; it only declares geometry and cell-space paint logic.
 *
 * `bounds` is in OBJECT SPACE (AGENTS.md contract 8): a chart object's data
 * cube is normalized to `[0,1]³`, so `objectPosition` (an effect's own
 * per-cell input) means DATA SPACE, not the object's authored vertex range.
 */
import type { Polygon, TextureSampler, Vec3 } from "@glyphcss/core";
import type { GlyphMeshTransform } from "./types";
import type { CellGrid, GlyphTransformCellsLayer } from "../render/cells";
import type { GlyphCamera } from "./createGlyphCamera";
import type { GlyphLabelArbiter } from "../render/overlay/labelArbiter";

/** One named mesh inside a `GlyphSceneObject`. Position/rotation/scale are the OBJECT's — a member has none of its own (glyphcss has no nested groups). */
export interface GlyphSceneObjectMesh {
  /** Stable name — the effect-targeting handle key (`handle.meshes.get(name)`) and the mesh's own `GlyphMeshHandle.name`. */
  readonly name: string;
  readonly polygons: Polygon[];
  readonly options?: Omit<GlyphMeshTransform, "position" | "rotation" | "scale">;
}

/** A DOM hit target planted at an OBJECT-SPACE point. No click handler here — a consumer reads it off `GlyphSceneObjectHandle`'s own escape hatch, or wires one after mount via the scene's own `addHotspot`. */
export interface GlyphSceneObjectHotspot {
  readonly id: string;
  readonly at: Vec3;
}

/**
 * Per-render context an overlay's `stamp()` reads. Everything is scoped to
 * THIS object and THIS output grid (base, a detail mesh's own grid, or a
 * meshless viewport overlay) — an object mounted twice, or a scene with two
 * objects, never shares a `toWorld`/`ownMeshIds` pair.
 */
export interface GlyphOverlayFrame {
  readonly camera: GlyphCamera;
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  /** Which scene layer this grid is (`undefined` only on a direct `rasterizeContext` call with no scene — see `GlyphTransformCellsLayer`'s own doc). */
  readonly layer: GlyphTransformCellsLayer | undefined;
  /** Object-space point → world space, through this mount's own position/rotation/scale. */
  toWorld(p: Vec3): Vec3;
  /** This object's own mesh ids — the `CellGrid.winnerMesh` set a label may paint over without being called "hidden behind a foreign mesh". */
  readonly ownMeshIds: ReadonlySet<number>;
  /** ONE arbiter shared by every object stamping into THIS grid this frame — see `render/overlay/labelArbiter.ts`. */
  readonly labels: GlyphLabelArbiter;
}

/**
 * An ordered, per-output-grid paint step. Overlays from every mounted object
 * compose into ONE registry, sorted by `order` (default `0`) then mount
 * order then declaration order within the object — and run AFTER Glyph
 * Effects, BEFORE the scene's own `transformCells` hook (AGENTS.md contract
 * 2), so an axis or a label survives a glitch/scramble effect and a
 * consumer's own hook still sees (and may override) the final cell.
 */
export interface GlyphSceneOverlay {
  readonly id: string;
  readonly order?: number;
  stamp(grid: CellGrid, frame: GlyphOverlayFrame): void;
}

export interface GlyphSceneObject {
  readonly id: string;
  readonly meshes: readonly GlyphSceneObjectMesh[];
  readonly overlays?: readonly GlyphSceneOverlay[];
  readonly hotspots?: readonly GlyphSceneObjectHotspot[];
  readonly textureSamplers?: ReadonlyMap<string, TextureSampler>;
  /** OBJECT-SPACE bounds — see this file's own top-of-file doc. */
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
}

export interface GlyphSceneObjectTransform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
}

export interface GlyphSceneObjectHandle {
  /** Live — `addObject`/`update` repopulate this SAME map, so a reference captured at mount stays current. */
  readonly meshes: ReadonlyMap<string, import("./createGlyphScene").GlyphMeshHandle>;
  setTransform(transform: GlyphSceneObjectTransform): void;
  /** Replaces meshes/overlays/hotspots/samplers wholesale, keeping the object's mount transform and this handle's identity. */
  update(object: GlyphSceneObject): void;
  remove(): void;
}
