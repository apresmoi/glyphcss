import type { Vec3, Polygon } from "@glyphcss/core";

/** Directional light — single distant source for the ASCII rasterizer. */
export interface GlyphDirectionalLight {
  direction: Vec3;
  intensity?: number;
  /** Hex color (#rrggbb). Tints the lit-side per-cell output. Default white. */
  color?: string;
}

/** Ambient light — uniform fill regardless of orientation. */
export interface GlyphAmbientLight {
  intensity?: number;
  /** Hex color (#rrggbb). Tints the unlit-side fill. Default white. */
  color?: string;
}

export interface GlyphMeshState {
  id: number;
  polygons: Polygon[];
  transform: GlyphMeshTransform;
}

export interface GlyphMeshTransform {
  /** String identifier for the mesh — surfaced as `GlyphMeshHandle.name`. */
  id?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}
