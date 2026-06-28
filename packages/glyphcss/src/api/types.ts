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
  /**
   * Per-mesh character cell size. Setting `fontSize` and/or `lineHeight` pops
   * this mesh OUT of the scene's shared `<pre>` into its own silhouette-fitted,
   * translated `<pre>` rendered at that cell size — so a "hero" mesh can carry
   * far more glyph detail than the rest of the scene, which stays in the shared
   * low-res grid. Omit both (the default) and the mesh renders in the shared
   * `<pre>` like every other mesh. A smaller cell = finer detail. `fontSize`
   * accepts a number (px) or any CSS length string. Orthographic cameras only;
   * requires the scene to be laid out (browser, not SSR).
   */
  /**
   * Per-mesh detail multiplier — the ergonomic way to pop a mesh into its own,
   * finer `<pre>`. `density: 3` renders this mesh at 3× the scene's glyph
   * resolution (cell = base cell ÷ density), isotropically, at the same on-screen
   * size. `1`/omitted = the shared base `<pre>`. This is the recommended knob;
   * `fontSize`/`lineHeight` below are the low-level escape hatch for anisotropic
   * cells and OVERRIDE `density` when present.
   */
  density?: number;
  fontSize?: string | number;
  /** See `fontSize` — line-height for this mesh's own cell (smaller = denser rows). */
  lineHeight?: number;
  /**
   * Whether this mesh blocks what's behind it. Default `false` (opaque — it
   * occludes, the realistic look). Set `true` to make it see-through: it doesn't
   * hide other meshes and isn't hidden by them (x-ray / blueprint layering).
   *
   * A mesh in the shared `<pre>` always occludes (one depth buffer), so declaring
   * `transparent: true` also pops the mesh OUT into its own `<pre>` — separation
   * happens for custom cell metrics OR transparency.
   */
  transparent?: boolean;
}
