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

/** Shadow configuration for the ASCII rasterizer (shadow-map technique). */
export interface GlyphShadowOptions {
  /** Shadow tint color. Default "#000000". */
  color?: string;
  /** Shadow darkness 0..1 — how much the shadowed color darkens toward `color`. Default 0.25. */
  opacity?: number;
  /**
   * Depth bias added to the interpolated surface depth before comparing against
   * the shadow map. Eliminates self-shadow acne on flat lit surfaces. Default 0.05.
   */
  lift?: number;
  /**
   * Maximum world-space extent for the shadow-map ortho projection.
   * Kept for API parity with polycss. Used as the half-extent of the light-space
   * projection volume when larger than the computed scene bounds. Default 2000.
   */
  maxExtend?: number;
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
  /** This mesh casts shadows onto receiveShadow surfaces. Default false. */
  castShadow?: boolean;
  /** This mesh receives (displays) shadows from castShadow meshes. Default false. */
  receiveShadow?: boolean;
  /**
   * Relative depth bias (0 = off). Nudges this mesh toward (positive) or away
   * from (negative) the camera in the depth test via `pixelDepth *= 1 + depthBias`
   * — resolving z-fighting against coplanar/coincident geometry. A CSS/DOM
   * renderer decides coincident surfaces by stacking order for free; a
   * projection-painted depth buffer fights, so a tiny bias (e.g. 0.002) lets a
   * dynamic surface (a door/platform flush into a wall/floor) win cleanly.
   */
  depthBias?: number;
}
