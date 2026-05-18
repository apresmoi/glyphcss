import type { Vec3, Polygon } from "@glyphcss/core";

/** Directional light — single distant source for the ASCII rasterizer. */
export interface GlyphcssDirectionalLight {
  direction: Vec3;
  intensity?: number;
  /** Hex color (#rrggbb). Tints the lit-side per-cell output. Default white. */
  color?: string;
}

/** Ambient light — uniform fill regardless of orientation. */
export interface GlyphcssAmbientLight {
  intensity?: number;
  /** Hex color (#rrggbb). Tints the unlit-side fill. Default white. */
  color?: string;
}

export interface GlyphcssMeshState {
  id: number;
  polygons: Polygon[];
  transform: GlyphcssMeshTransform;
}

export interface GlyphcssMeshTransform {
  /** String identifier for the mesh — surfaced as `GlyphcssMeshHandle.name`. */
  id?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}
