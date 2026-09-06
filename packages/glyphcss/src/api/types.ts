import type { Vec3, Polygon, RenderMode } from "@glyphcss/core";

/** Directional light — single distant source for the ASCII rasterizer. */
export interface GlyphDirectionalLight {
  /** Unit source vector from the surface toward the distant light. */
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

/**
 * One step of a `solidWeightRamp` (solid-mode-only, see
 * {@link RasterizeContextOptions.solidWeightRamp}): a single (glyph,
 * font-weight) pair, positioned by measured ink coverage rather than by
 * glyph shape alone. Ordered darkest → densest, same convention as a plain
 * ramp string — index `i` is reached at shade `i / (steps.length - 1)`.
 * `@glyphcss/effects`' `calibrateWeightedGlyphRamp` produces this shape
 * directly from real per-font measurement; it is never hand-authored.
 */
export interface GlyphSolidWeightRampStep {
  glyph: string;
  /** CSS `font-weight`, e.g. `400` or `700`. */
  weight: number;
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
   * Cross-layer occlusion priority for an OPAQUE detail mesh (one with its own
   * `density`/`fontSize` layer). Groups in the scene's shared occlusion id-map
   * claim cells by priority FIRST and depth second: a higher-priority mesh
   * occludes every lower-priority layer (the base world included) wherever its
   * triangles cover, and cannot be occluded by them — depth only competes
   * within the same priority. It is the declarative form of a FOREGROUND
   * layer that must never be occluded by scene geometry: give it
   * `occlusionPriority: 1` and it punches every priority-0 layer out of its
   * silhouette no matter how near that geometry gets. Negative classes work
   * the same way in reverse (a background layer any ordinary mesh occludes);
   * an unclaimed cell is claimable by any class. Default 0 (plain depth).
   * No effect on `transparent` meshes (they opt out of occlusion entirely).
   */
  occlusionPriority?: number;
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
  /**
   * SHARED DETAIL OUTPUT (ADDITIVE, default: each detail mesh gets its own).
   * Every detail mesh declaring the same `detailGroup` name renders into ONE
   * silhouette-fitted `<pre>` — one grid, one rasterizer pass, one entry in
   * the shared cross-layer occlusion id-map — instead of one per mesh.
   *
   * The reason it exists is not economy, it is CORRECTNESS at a shared edge.
   * Two abutting meshes in two separate detail outputs each point-sample
   * coverage on their OWN cell lattice, and those lattices are fitted to two
   * different silhouettes, so they are differently phased: on a curved,
   * foreshortened surface a sub-cell sliver along the edge they share can fall
   * inside neither sample and nothing paints it. That is a seam — a dark line
   * along every shared edge — and no occlusion refinement can close it,
   * because neither layer ever claimed the cell in the first place. One grid
   * has one lattice: the cell is sampled once, and whichever mesh covers it
   * paints it. Members also cannot occlude each other, since they are one
   * layer id (within the group, ordinary per-cell depth decides, exactly as it
   * does for two meshes sharing the base grid).
   *
   * `@glyphcss/maps` is the reference consumer: a raster layer mounts one mesh
   * per TILE, so at `density > 1` its tile boundaries were a visible grid of
   * dark lines. Grouping the tiles of one layer removes the boundaries rather
   * than papering over them.
   *
   * Names are scoped to the scene and are stable: a group keeps its `<pre>`
   * and its occlusion id across renders as members come and go, so a tile
   * pyramid can churn its meshes without recreating DOM.
   *
   * Grouping is only meaningful for a mesh that is ALREADY a detail mesh (see
   * `density`/`fontSize`/`transparent`/`glyphPalette`/`ambientIntensity`/
   * `mode`) — it never separates a mesh by itself, so a scene that sets it on
   * meshes at `density: 1` is byte-identical to one that does not.
   *
   * Because one output has ONE cell size, ONE render mode and ONE occlusion
   * claim, every member of a group must agree on `density`, `fontSize`,
   * `lineHeight`, `transparent`, `glyphPalette`, `ambientIntensity`, `mode`,
   * `occlusionPriority`, `occlusionClaim` and `occlusionContourPx`. A
   * disagreement is a caller error and throws a `RangeError` naming the group
   * and the field, rather than silently picking one member's value.
   */
  detailGroup?: string;
  /**
   * PER-MESH glyph ramp palette (solid mode) — this mesh rasterizes its
   * intensity→character ramp from the named palette instead of the scene's
   * `glyphPalette`. LOUD CAVEATS, read before using:
   *
   *  - Setting it pops the mesh OUT of the shared base `<pre>` into its own
   *    detail layer (like `density`/`fontSize`/`transparent` do): the shared
   *    grid is rasterized in one pass against one ramp, so a private ramp
   *    NEEDS a private layer. A mesh with only `glyphPalette` set renders at
   *    the base cell size, in its own `<pre>`.
   *  - Solid-mode ramps only. Wireframe junctions, `charMode` encodings and
   *    `solidWeightRamp` stay scene-level.
   *  - Unknown names resolve to the library default palette, exactly like the
   *    scene-level option — sanitize upstream if your app restricts ramps.
   *
   * Omitted (the default) = the scene's palette; behaviour is unchanged.
   */
  glyphPalette?: string;
  /**
   * PER-MESH render mode — this mesh rasterizes in `mode` instead of the
   * scene's own. Same structural reason `glyphPalette`/`ambientIntensity`
   * force separation: the shared `<pre>` is rasterized in ONE pass under ONE
   * mode, so a private mode needs a private layer. A mesh declaring only
   * `mode` renders in its own `<pre>` at the BASE cell size — a separate
   * pass, no extra detail.
   *
   * Unlike `glyphPalette`, separation is conditional on the mode actually
   * being different: declaring the mode the scene is already rendering in
   * keeps the mesh in the shared base grid, byte-identical and one pass. A
   * mode is a small closed enum compared exactly, so "is this genuinely
   * private?" is answerable here — `glyphPalette` cannot answer it (an
   * unrecognized name silently resolves to the default ramp, so two
   * different strings can name the same ramp). The comparison is re-made
   * every render, so a `setOptions({ mode })` that matches lets the mesh
   * rejoin the base grid on the next frame.
   *
   * Every extra distinct mode in a scene is a full extra rasterizer pass —
   * reach for this per LAYER, not per mesh, and leave it omitted for
   * anything that can share the scene's mode.
   *
   * Occlusion is unchanged: a mode-separated OPAQUE mesh still claims its
   * full footprint in the shared id-map, so an outline mode (`wireframe`,
   * `ink`) blanks the base cells under its silhouette while painting only
   * edges. Declare `transparent: true` alongside it for the x-ray layering
   * an outline over other geometry usually wants.
   *
   * Omitted (the default) = the scene's mode; behaviour is unchanged.
   */
  mode?: RenderMode;
  /**
   * PER-MESH ambient light intensity (solid mode) — this mesh's own detail
   * layer rasterizes under `{ ...scene.ambientLight, intensity }`, so both its
   * glyph choice (shade = clamp(light) × texel luma) and its texel colour tint
   * track this value instead of the scene's. LOUD CAVEATS, same family as
   * `glyphPalette`:
   *
   *  - Setting it pops the mesh OUT of the shared base `<pre>` into its own
   *    detail layer (the shared grid is lit in one pass under one ambient).
   *  - The ambient COLOUR and the directional/key light stay scene-level.
   *  - Omitted (the default) = the scene's ambient; behaviour is unchanged.
   */
  ambientIntensity?: number;
  /**
   * PER-MESH claim shape (ADDITIVE, default "alpha"): "geometry" makes this
   * mesh claim its full triangle footprint regardless of texel alpha — the
   * pre-alpha-aware "filled plate" behaviour, for a partial-alpha textured
   * sprite that wants a solid ground under its artwork rather than a claim
   * that hugs its ink. Everything else keeps alpha-aware claims.
   */
  occlusionClaim?: "alpha" | "geometry";
  /**
   * PER-MESH contour claims (ADDITIVE): give this OPAQUE detail mesh a claim
   * that follows its artwork's ALPHA CONTOUR instead of point-sampled cells —
   * the id-map is rastered at a finer internal resolution, the claim becomes
   * coverage-aware (any output cell containing this mesh's ink claims — the
   * anti-theft guarantee), and the value is a margin in SCREEN PX stamped
   * around the ink in the fine map before reducing (elliptical reach, never
   * stealing from another detail mesh). `0` = tightest possible: exactly the
   * ink-bearing cells. The reduced map stays at output resolution, so the
   * ground the layer beneath loses is still quantized to output cells — the
   * map's hard floor. This is also the only way to buy fine artwork a small
   * clean ground around its ink; because the margin is a screen reach rather
   * than a count of cells it stays visually uniform on an anisotropic cell,
   * and its reach caps at `6 / supersample` output cells. Omitted =
   * pre-existing point-sampled claims.
   */
  occlusionContourPx?: number;
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
