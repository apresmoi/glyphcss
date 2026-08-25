import type {
  GridSize,
  RenderMode,
  WireframeEdge,
  Polygon,
  TextureSampler,
} from "@glyphcss/core";
import type { TransformCells, GlyphColorEncoding } from "../render/cells";
import type { GlyphCamera, GlyphProjectionMetrics } from "./createGlyphCamera";
import type { GlyphDirectionalLight, GlyphAmbientLight, GlyphShadowOptions, GlyphSolidWeightRampStep } from "./types";

/**
 * Cross-layer occlusion input. A shared buffer storing, per reference cell, the
 * id of the LAYER whose surface is nearest there (`-1` = empty). The rasterizer
 * blanks an output cell when the owner at its reference cell is a DIFFERENT layer
 * (`owner !== layerId`) — so a layer never occludes itself (its own self-depth is
 * already resolved inside its own rasterize), only other layers in front do.
 * `(colScale, colOffset)` / `(rowScale, rowOffset)` map this layer's OUTPUT cell
 * to a reference cell: `refCol = floor(colScale * outCol + colOffset)`.
 */
export interface OcclusionMap {
  idMap: Int32Array;
  layerId: number;
  cols: number;
  rows: number;
  colScale: number;
  colOffset: number;
  rowScale: number;
  rowOffset: number;
}

export interface RasterizeContextOptions {
  camera: GlyphCamera;
  grid: GridSize;
  /** Polygon list. Required for `solid` / `voxel` modes, optional otherwise. */
  polygons?: Polygon[];
  /** Explicit wireframe edges. If omitted in wireframe mode, edges are derived from `polygons` (fan-triangulated). */
  wireframe?: WireframeEdge[];
  mode?: RenderMode;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  /** Named wireframe glyph palette. Defaults to `"default"`. */
  glyphPalette?: string;
  /**
   * Character encoding for rasterized output. `"ascii"` (default) is the
   * original ramp/rule-glyph encoding. `"braille"` renders wireframe mode
   * using Unicode Braille Patterns (U+2800..U+28FF), packing a 2×4 subcell
   * dot grid into each output cell for visibly smoother diagonal/curved
   * edges than a single ASCII rule glyph per cell. `"braille"` is a
   * documented no-op in `solid`/`voxel`/`ink` modes — braille dot coverage is
   * binary and cannot carry a Lambert shade ramp, voxel face glyph, or ink's
   * oriented direction glyph, so those modes always render ASCII regardless
   * of this option.
   *
   * `"halfblock"` is the mirror trade-off, solid-mode-only: instead of
   * picking one glyph from a shade ramp per cell, it packs TWO independently
   * colored subcells (top + bottom) into `▀`/`▄`/`█`, buying 2× vertical
   * COLOR resolution at the cost of coarse (block) shape — exactly where
   * braille's binary coverage cannot carry a Lambert shade ramp. It borrows
   * the supersample subcell buffers (forcing an even supersample of at least
   * 2 internally when needed) and is a documented no-op outside `solid` mode,
   * when a `transformCells` hook is supplied, or during active temporal
   * reprojection (`temporalBlend > 0` with retained history) — those paths
   * all expect/produce the existing one-color-per-cell {@link CellGrid}.
   *
   * `"quadrant"` generalizes `"halfblock"` from a 1×2 (top/bottom) subcell
   * split to a full 2×2 split, packing a 4-region coverage mask into one of
   * 16 Unicode quadrant/half/full-block glyphs (space, `▘▝▖▗▀▄▌▐▚▞█`, and the
   * four three-quadrant glyphs `▛▜▙▟`) — twice halfblock's shape resolution
   * at the same two-colors-per-cell markup cost (`▀`/`▄` are two of these 16
   * masks). A partially-covered cell picks the exact coverage-mask glyph with
   * one collapsed average color (no `background-color` — that would have to
   * paint an uncovered region); a fully-covered cell either collapses to a
   * single-color `█` or splits into a genuine two-tone glyph via a
   * mean-luminance threshold over the 4 regions. Same eligibility rule as
   * `"halfblock"`: solid-mode-only, forces the same even supersample ≥2, and
   * is a documented no-op with a `transformCells` hook or active
   * `temporalBlend` reprojection.
   */
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  /**
   * Box-drawing junction resolve pass (wireframe + `charMode: "ascii"` only;
   * documented no-op for `"braille"` — which already derives corners/joins
   * from its own subcell dot mask — and for `ink`, which picks its own fixed
   * oriented glyph set and never consults this option). Default `false`.
   *
   * When `true`, a second pass runs over the finished wireframe stamp: every
   * near-axis-aligned edge accumulates which of a cell's four sides (N/E/S/W)
   * carry a line, and cells with a non-zero side mask render from the fixed
   * `┌┐└┘├┤┬┴┼─│` box-drawing set keyed by that mask instead of the default
   * per-tier random glyph — so two edges meeting in one cell (a corner or a
   * T-junction) resolve to ONE glyph consistent with both, instead of
   * whichever edge happened to rasterize last. An edge counts as
   * "near-axis-aligned" when its two projected endpoints round to the same
   * output row (near-horizontal) or the same output column (near-vertical) —
   * equivalently, under half a cell of perpendicular drift across the whole
   * edge. This scales with edge length instead of a fixed angle constant, and
   * a diagonal-dominant edge (endpoints round to neither) contributes nothing
   * to the mask, so its cells keep the existing slope-glyph behavior
   * unchanged. Default `false` keeps rasterize output byte-identical.
   */
  wireframeJunctions?: boolean;
  /**
   * Hidden-line removal for the wireframe path (wireframe + `charMode:
   * "braille"`; documented no-op in `solid`, which is already depth-buffered
   * per cell, and in `ink` — a flat-bias spike regressed every convex mesh
   * there, see `research/contour-first-text/decisions.md`, and is not wired
   * into this option). Default `"show"` (today's behavior: edges draw in
   * mesh order with no depth reference, so a farther edge can paint over a
   * nearer one — byte-identical output).
   *
   * `"hide"` depth-tests every wireframe stroke sample against a solid
   * surface prepass (the same triangle-depth rasterizer
   * {@link OcclusionMap} uses) with a slope-scaled bias, so an edge that is
   * genuinely behind another mesh's surface (or the far side of its own
   * mesh) does not paint through it — fixing cross-letter/cross-mesh
   * side-wall bleed-through and darker `sideColor` edges overwriting a
   * brighter front face. Also wired in `mode: "ink"`, with an identity-based
   * test instead of a margin: each kept silhouette/crease edge exempts its
   * own local vertex neighborhood from occluding it, so a mesh's own
   * silhouette never self-occludes, while a genuinely different, farther
   * surface still hides it. A string union (not boolean) because a future
   * `"dashed"` state (hidden lines drawn faintly, classic CAD convention)
   * should not require a breaking change.
   */
  hiddenLines?: "show" | "hide";
  /**
   * Solid-mode-only second density axis: a font-weight-calibrated ramp of
   * (glyph, `font-weight`) steps, ordered darkest → densest by MEASURED ink
   * coverage (see `@glyphcss/effects`' `calibrateWeightedGlyphRamp`, which
   * crosses a glyph pool against candidate `font-weight` values through real
   * canvas measurement — never a hand-authored table). When set (length > 0),
   * it REPLACES `glyphPalette`'s solid ramp for this render: solid mode picks
   * both a glyph AND a `font-weight` from these steps instead of only a
   * glyph, buying MORE perceptually distinct shading steps than the glyph
   * pool's shape count alone provides (bold ink coverage measurably differs
   * per weight without changing monospace advance width, so a weight-bearing
   * span never desyncs the character grid — see `AGENTS.md`). Default
   * `undefined` (off): rasterize output is byte-identical to before this
   * option existed. Documented no-op during active temporal-blend
   * reprojection (`temporalBlend > 0` with retained history) — reprojection
   * blends the ramp index continuously across frames and has no notion of a
   * parallel weight lookup, the same precedent as `charMode: "halfblock"`
   * being a no-op there.
   */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  /**
   * Row-wise greedy run-extension against an anchor color (COLOR-TOLERANCE.md):
   * a run keeps extending while the next cell's true color is within
   * `colorTolerance` of the run's anchor (redmean distance), emitting the
   * anchor's color for the whole run — trading color fidelity for fewer
   * `<span>`s, which is what actually gates frame rate for colored output.
   * Default `0` = off, byte-identical output. **The metric's range is 0..765,
   * not 0..255** (black↔white is 764.83 under redmean) — a UI slider bound
   * that assumes 0..255 leaves two thirds of the range unreachable.
   *
   * Validated at this layer ({@link buildRasterizeContext}), not in the hot
   * encoder: `NaN` and negative values degrade to `0` (off); `+Infinity` is
   * honored as-is (every same-glyph run in a row merges to one span — a
   * legitimate, if extreme, choice, not an error); `-Infinity` degrades to
   * `0` like any other negative value.
   *
   * Applies to every colored render path THAT ENCODES THROUGH `rasterize()`
   * itself — wireframe and voxel (both plain and `"braille"` `charMode` —
   * voxel falls through to the wireframe branch and is covered), `ink`, and
   * `solid` (including `charMode: "halfblock"`/`"quadrant"`, where a run must
   * hold for both independent color channels). NOT gated behind `temporalBlend`:
   * measured with a control arm, tolerance pays off MOST under active TAA
   * reprojection (span reduction up to 4.5x on the measured fixture) — see
   * COLOR-TOLERANCE.md's Interactions section.
   *
   * Does NOT reach `glyphOutput: "semantic"` output, even though a
   * `RasterizeContext` carrying this option is still built for that path
   * (`createGlyphScene`'s `rasterizeToCells` call, used to retain the
   * winner-polygon buffer semantic output needs) — the final semantic
   * glyph/color string is produced separately, from the resolved class
   * lineage, and never goes through this context's own `rasterize()`/
   * encode step. Semantic colors are exact class identifiers, not shaded
   * appearance, so merging them under a tolerance would corrupt the
   * lineage — see {@link GlyphSceneOptions.colorTolerance}.
   */
  colorTolerance?: number;
  /**
   * Encode strategy for the final `<pre>` string. `"spans"` (default) is
   * today's HTML-span run-coalescing path — unset or `"spans"` is byte-
   * identical to before this option existed. `"atlas"` encodes `(glyph,
   * colour)` as Private Use Area code points against a checked-in COLR/CPAL
   * colour font, producing ONE text node with zero `<span>`s (see
   * `render/fontAtlas.ts` for the mapping scheme and `AGENTS.md`'s
   * `colorEncoding` section for the measurement this follows).
   *
   * Requires {@link atlasPalette}: without one, `"atlas"` degrades to
   * `"spans"` for that render (no palette to encode against — a
   * configuration gap, not an error, since the palette-derivation strategy
   * is a separate, later concern). When a palette IS supplied but a cell's
   * glyph or colour isn't representable in the atlas (an out-of-atlas
   * `glyphs` ramp character, or a colour the palette doesn't cover), the
   * WHOLE render falls back to `"spans"` for that frame — see
   * `isGlyphAtlasEncodable` (`render/cells.ts`) for why this is a per-scene,
   * not per-cell, decision.
   *
   * Documented no-op (`"spans"` behavior regardless of this option) in every
   * case a `<span>`-per-cell representation is structurally required:
   * `charMode: "halfblock"`/`"quadrant"` (two colours per cell — the atlas
   * only encodes one), `solidWeightRamp` actually selecting a `font-weight`
   * override (COLR/CPAL carries colour, not weight), `glyphOutput:
   * "semantic"` (already documented to ignore every presentation option,
   * `colorTolerance` included), and `useColors: false` (nothing to encode a
   * colour axis for).
   */
  colorEncoding?: GlyphColorEncoding;
  /**
   * Palette this render's `colorEncoding: "atlas"` cells are encoded
   * against — an ordered list of `#rrggbb` colors, each entry's POSITION
   * (never its value) becoming the PUA mapping's palette-slot axis (see
   * `render/fontAtlas.ts`). Deriving this palette (global quantization, a
   * pooled orbit palette, periodic refresh, a precomputed hue-rotation bank
   * — anything beyond "here is the array") is explicitly out of scope for
   * this option: it is an injected input, not a policy this layer
   * implements. `undefined` (default) means `colorEncoding: "atlas"` has
   * nothing to encode against and degrades to `"spans"`.
   */
  atlasPalette?: readonly string[];
  /**
   * When `false`, the rasterizer emits plain text (no <span> wrappers). The
   * output is just one text node — fastest possible DOM update. Default `true`.
   */
  useColors?: boolean;
  /**
   * Smooth (Gouraud) shading. When `true`, per-pixel Lambert intensity is
   * interpolated from per-vertex normals (averaged across adjacent polygons
   * within `creaseAngle`). Default `false` — flat shading is glyph's default
   * because the facets are part of the ASCII aesthetic.
   */
  smoothShading?: boolean;
  /**
   * Crease angle in degrees for smooth shading. Vertex normals are averaged
   * across adjacent faces whose normals diverge by less than this angle;
   * edges sharper than this stay flat-shaded. `0` collapses to pure flat
   * shading; `180` smooths every shared vertex. Default `60`.
   */
  creaseAngle?: number;
  /**
   * Render both faces of every polygon (no backface culling). Default `false`
   * (cull back faces — correct + faster for closed meshes). Set `true` for
   * single-sided surfaces whose winding isn't guaranteed to face the camera —
   * e.g. level geometry imported from a BSP — matching how a CSS/DOM renderer
   * (polycss) shows both sides. Without it, "back-wound" faces vanish.
   * Lighting remains one-sided: the authored polygon normal is still used for
   * Lambert shading, so a backface does not get direct light via `abs(dot)`.
   */
  doubleSided?: boolean;
  /**
   * Supersampled anti-aliasing factor (solid mode). `1` (default) = off. `2`/`3`
   * rasterize at N× the grid resolution and box-average down, removing the
   * motion crawl where sub-cell-sized surfaces flip their per-cell winner
   * frame-to-frame. Cost scales ~N². Use `2` for a big stability win at ~4× cost.
   */
  supersample?: number;
  /**
   * Temporal anti-aliasing: exponential blend of this frame with the previous
   * one, weight in [0,1) (history weight). `0` (default) = off. Smooths the
   * frame-to-frame crawl of edges that move faster than spatial supersampling
   * can cover, at the cost of motion ghosting. Needs `temporalHistory` retained
   * across renders (the scene does this).
   */
  temporalBlend?: number;
  shadow?: GlyphShadowOptions;
  /** Per-polygon cast flag (parallel to `polygons` array). True = this poly's mesh has castShadow. */
  castShadowFlags?: boolean[];
  /** Per-polygon receive flag (parallel to `polygons` array). True = this poly's mesh has receiveShadow. */
  receiveShadowFlags?: boolean[];
  /** Per-polygon relative depth bias (parallel to `polygons`). `pixelDepth *= 1 + bias`. */
  depthBiases?: number[];
  /**
   * Per-polygon owning-mesh id (parallel to `polygons`), the same
   * `globalPolygonOffsets` mesh-identity convention the semantic winner
   * buffer uses. Only meaningful (and only supplied) when `retainObjectExit`
   * is active: the exit sweep restricts its farthest-depth scan per cell to
   * the mesh that won that cell in the main pass, so a farther, non-winning
   * mesh's back face can never leak into another mesh's exit point.
   */
  polygonMeshIds?: number[];
  /**
   * Global depth-test deadband (0 = exact, the default). A polygon replaces the
   * current cell only when nearer by more than this relative fraction, so
   * near-coplanar surfaces (overlapping brushes, decals, a translucent plane
   * over its backing face) keep a STABLE winner instead of z-fighting per-cell
   * as the camera moves. A CSS/DOM renderer gets this for free from stacking
   * order; a projection-painted depth buffer needs the deadband. Typical 0.002–0.01.
   */
  depthEpsilon?: number;
  /** Optional cross-layer occlusion map (see {@link OcclusionMap}). */
  occlusion?: OcclusionMap | null;
  /**
   * Decoded texture samplers keyed by the authored texture URL. This is an
   * explicit input for pure/headless callers; interactive scenes populate the
   * same field after browser decoding.
   */
  textureSamplers?: Map<string, TextureSampler> | null;
  /** Retain the final solid-mode per-cell shading scalar for an effect input. */
  retainShade?: boolean;
  /** Retain depth-winning world positions for an effect input. */
  retainWorldPosition?: boolean;
  /** Retain depth-winning geometric face normals for an effect input. */
  retainNormal?: boolean;
  /**
   * Retain depth-winning positions in each mesh's own pre-transform 3D frame
   * for an effect input (`space: "object"`).
   */
  retainObjectPosition?: boolean;
  /**
   * Retain the farthest object-space intersection of the depth-winning mesh
   * along each cell's view ray (`objectExit` effect input — see
   * VOLUMETRIC.md "Step 1"). Requires a second, all-faces, near-plane-
   * clipping farthest-depth sweep restricted per cell to the winning mesh
   * (via `polygonMeshIds`), so this is allocated and run ONLY when a mounted
   * effect's requirement asks for it — zero cost otherwise.
   */
  retainObjectExit?: boolean;
  /**
   * Retain depth-winning geometric face normals in each mesh's own
   * pre-transform 3D frame for an effect input (`objectNormal` — see
   * VOLUMETRIC-4.md "Phase 0"). Computed at the same scan-fill call site as
   * `objectPosition`, from the cross product of the same `ov0/ov1/ov2`
   * object vertices — the self-consistent object-frame pair to
   * `objectPosition`/`objectExit`, since the existing `normal` buffer is
   * WORLD space and cannot be combined with the object-space ray for a
   * rotated mesh.
   */
  retainObjectNormal?: boolean;
  /**
   * Retain the positional source-polygon index that won each solid cell.
   * `-1` marks an empty cell. This is an opaque lookup key for durable control
   * capture; it is not a semantic label and is never allocated by default.
   */
  retainWinnerPolygon?: boolean;
  /**
   * Retain the winning MESH id per cell (solid mode only) — the substrate
   * for per-object effect targeting (`targetCoverage`). ORed with
   * {@link RasterizeContextOptions.retainObjectExit}'s own need for the same
   * internal buffer: either flag causes `polygonMeshIds` to actually be
   * consulted and the resulting per-cell winner to be downsampled and
   * exposed on `CellGrid.winnerMesh`. Compositor-internal — never a
   * `GlyphEffectRequirement`, never read by a program directly.
   */
  retainWinnerMesh?: boolean;
  /** Retain the unlit albedo from the depth-winning surface. */
  retainAlbedoRgb?: boolean;
  /** Retain final lit RGB from the depth-winning surface. */
  retainTargetRgb?: boolean;
  /**
   * Optional post-rasterize cell hook (M4 composition effects). When supplied,
   * the rasterizer builds a {@link CellGrid} from its final per-cell buffers,
   * runs the hook, then stringifies the (possibly mutated) grid — all BEFORE the
   * single `<pre>` write. When absent (default), no grid is built and output is
   * byte-identical to the pre-hook renderer. See {@link TransformCells}.
   */
  transformCells?: TransformCells;
}

/**
 * Cross-frame per-triangle shading cache. The Lambert intensities and lit
 * color depend only on world-space normals + light, never the camera — so
 * during a camera-only change (orbit/zoom drag) they are identical frame to
 * frame. Parallel arrays indexed by positional triangle order; lazily filled
 * as triangles become visible. The scene clears it when geometry, light, or
 * shading options change. Absent/null → always recompute (current behavior).
 */
export interface ShadeCache {
  iA: number[];
  iB: number[];
  iC: number[];
  lit: (string | null)[];
}

/**
 * Retained previous-frame buffer for temporal anti-aliasing. Per output cell:
 * blended ramp index + RGB. The scene keeps one and reuses it across renders;
 * `rasterize` resets it when the grid size changes.
 */
export interface TemporalHistory {
  idx: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  cols: number;
  rows: number;
  /** Snapshot of the camera that produced the stored frame (for reprojection). */
  cam: {
    kind: "perspective" | "orthographic";
    rotX: number; rotY: number; target: [number, number, number];
    zoom: number; perspective: number; distance: number; stretch: number; fovScale: number;
    center: [number, number];
    metrics?: GlyphProjectionMetrics;
  } | null;
}

export interface RasterizeContext {
  camera: GlyphCamera;
  grid: GridSize;
  polygons: Polygon[];
  wireframe: WireframeEdge[];
  mode: RenderMode;
  directionalLight: GlyphDirectionalLight;
  ambientLight: GlyphAmbientLight;
  /** Named wireframe glyph palette passed to the rasterizer. */
  glyphPalette: string;
  /** Character encoding — see {@link RasterizeContextOptions.charMode}. */
  charMode: "ascii" | "braille" | "halfblock" | "quadrant";
  /** Box-drawing junction resolve pass — see {@link RasterizeContextOptions.wireframeJunctions}. */
  wireframeJunctions: boolean;
  /** Wireframe hidden-line removal — see {@link RasterizeContextOptions.hiddenLines}. */
  hiddenLines: "show" | "hide";
  /** Solid-mode font-weight density ramp — see {@link RasterizeContextOptions.solidWeightRamp}. */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  /** Run-extension color merge tolerance — see {@link RasterizeContextOptions.colorTolerance}. Always a validated, non-negative number (or `+Infinity`); never `NaN`. */
  colorTolerance: number;
  /** Final-string encode strategy — see {@link RasterizeContextOptions.colorEncoding}. Always `"spans"` or `"atlas"`, never `undefined`. */
  colorEncoding: GlyphColorEncoding;
  /** Palette `colorEncoding: "atlas"` encodes against — see {@link RasterizeContextOptions.atlasPalette}. */
  atlasPalette?: readonly string[];
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  doubleSided: boolean;
  supersample: number;
  temporalBlend: number;
  shadow: GlyphShadowOptions | undefined;
  castShadowFlags: boolean[];
  receiveShadowFlags: boolean[];
  depthBiases?: number[];
  /** Per-polygon owning-mesh id — see {@link RasterizeContextOptions.polygonMeshIds}. */
  polygonMeshIds?: number[];
  /** Global depth-test deadband — see {@link RasterizeContextOptions.depthEpsilon}. */
  depthEpsilon?: number;
  /** Optional cross-frame shading cache (see {@link ShadeCache}). */
  shadeCache?: ShadeCache | null;
  /**
   * Decoded texture pixel samplers keyed by texture URL. When a polygon has a
   * texture + UVs and its sampler is present here, the solid rasterizer samples
   * the texture per cell (full image, glyph-resolution) instead of using the
   * flat baked `poly.color`. Built by the scene via `buildTextureSamplers`.
   */
  textureSamplers?: Map<string, TextureSampler> | null;
  /** Optional retained previous-frame buffer for temporal AA. */
  temporalHistory?: TemporalHistory | null;
  /** Optional cross-layer occlusion map (see {@link OcclusionMap}). */
  occlusion?: OcclusionMap | null;
  /** Retain the final solid-mode per-cell shading scalar for an effect input. */
  retainShade?: boolean;
  /** Retain depth-winning world positions for an effect input. */
  retainWorldPosition?: boolean;
  /** Retain depth-winning geometric face normals for an effect input. */
  retainNormal?: boolean;
  /** Retain depth-winning pre-transform (mesh-local) positions for an effect input. */
  retainObjectPosition?: boolean;
  /** Retain the farthest object-space exit position for an effect input — see {@link RasterizeContextOptions.retainObjectExit}. */
  retainObjectExit?: boolean;
  /** Retain depth-winning object-space face normals — see {@link RasterizeContextOptions.retainObjectNormal}. */
  retainObjectNormal?: boolean;
  /** Retain the positional source-polygon winner for durable control capture. */
  retainWinnerPolygon?: boolean;
  /** Retain the winning mesh id per cell — see {@link RasterizeContextOptions.retainWinnerMesh}. */
  retainWinnerMesh?: boolean;
  /** Retain the unlit albedo from the depth-winning surface. */
  retainAlbedoRgb?: boolean;
  /** Retain final lit RGB from the depth-winning surface. */
  retainTargetRgb?: boolean;
  /** Optional post-rasterize cell hook — see {@link RasterizeContextOptions.transformCells}. */
  transformCells?: TransformCells;
}

// Source vector from the surface toward the distant light.
const DEFAULT_DIRECTIONAL: GlyphDirectionalLight = { direction: [0.5, 0.7, 0.5], intensity: 1 };
const DEFAULT_AMBIENT: GlyphAmbientLight = { intensity: 0.4 };

function polygonsToWireframeEdges(polygons: Polygon[]): WireframeEdge[] {
  // Derive deduplicated edges by fan-triangulating each polygon and collecting
  // unique vertex pairs (sorted key). Color is taken from the first polygon seen.
  const seen = new Set<string>();
  const out: WireframeEdge[] = [];
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    // Emit each polygon edge (consecutive pairs, wrapping around).
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i]!;
      const b = verts[(i + 1) % verts.length]!;
      const k1 = `${a[0]},${a[1]},${a[2]}`;
      const k2 = `${b[0]},${b[1]},${b[2]}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const edge: WireframeEdge = { from: a, to: b, weight: 2 };
      if (poly.color) edge.color = poly.color;
      out.push(edge);
    }
  }
  return out;
}

/**
 * Public-layer validation for `colorTolerance` (COLOR-TOLERANCE.md Phase 3):
 * runs once per {@link buildRasterizeContext} call, never in the hot encoder.
 * `undefined` and `NaN` degrade to `0` (off) rather than throwing or
 * propagating `NaN` into a per-cell comparison. A negative value degrades to
 * `0` the same way (there is no meaningful "negative tolerance"). `+Infinity`
 * is honored as-is: `withinColorTolerance`'s `d2 <= tolerance^2` comparison
 * is trivially true for any finite `d2`, so this deliberately merges every
 * same-glyph run in a row — an extreme but valid configuration, not an
 * error. `-Infinity` falls out of the same negative-degrades-to-0 rule.
 *
 * Exported so every public entry point that stores a `colorTolerance` before
 * it reaches {@link buildRasterizeContext} (`createGlyphScene`'s internal
 * `options`, read directly by the retained-effect-layer `encodeCellGrid`
 * path, which never calls `buildRasterizeContext`) can normalize once at the
 * same layer instead of duplicating this rule or leaving that second path
 * unvalidated.
 */
export function normalizeGlyphColorTolerance(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  if (value === Infinity) return Infinity;
  return value > 0 ? value : 0;
}

/**
 * Public-layer validation for `colorEncoding`, mirroring
 * {@link normalizeGlyphColorTolerance}'s "validate once here, never in the
 * hot encoder" discipline. `undefined` degrades to `"spans"` — the byte-
 * identical default. Unlike `colorTolerance`'s numeric degrade-don't-throw
 * rule, an actually-supplied-but-invalid string is a caller mistake (same
 * category as an invalid `mode`/`glyphOutput`/`charMode` string elsewhere in
 * this file), so it throws rather than silently degrading.
 */
export function normalizeGlyphColorEncoding(value: GlyphColorEncoding | undefined): GlyphColorEncoding {
  if (value === undefined) return "spans";
  if (value !== "spans" && value !== "atlas") {
    throw new TypeError(`glyphcss: colorEncoding must be "spans" or "atlas" (got ${JSON.stringify(value)}).`);
  }
  return value;
}

export function buildRasterizeContext(opts: RasterizeContextOptions): RasterizeContext {
  const polygons = opts.polygons ?? [];
  const mode = opts.mode ?? (polygons.length ? "solid" : "wireframe");
  const wireframe = opts.wireframe ?? (mode === "wireframe" ? polygonsToWireframeEdges(polygons) : []);
  return {
    camera: opts.camera,
    grid: opts.grid,
    polygons,
    wireframe,
    mode,
    directionalLight: opts.directionalLight ?? DEFAULT_DIRECTIONAL,
    ambientLight: opts.ambientLight ?? DEFAULT_AMBIENT,
    glyphPalette: opts.glyphPalette ?? "default",
    charMode: opts.charMode ?? "ascii",
    wireframeJunctions: opts.wireframeJunctions ?? false,
    hiddenLines: opts.hiddenLines ?? "show",
    colorTolerance: normalizeGlyphColorTolerance(opts.colorTolerance),
    colorEncoding: normalizeGlyphColorEncoding(opts.colorEncoding),
    atlasPalette: opts.atlasPalette,
    useColors: opts.useColors ?? true,
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    temporalBlend: opts.temporalBlend ?? 0,
    shadow: opts.shadow,
    castShadowFlags: opts.castShadowFlags ?? [],
    receiveShadowFlags: opts.receiveShadowFlags ?? [],
    retainShade: opts.retainShade ?? false,
    retainWorldPosition: opts.retainWorldPosition ?? false,
    retainNormal: opts.retainNormal ?? false,
    retainObjectPosition: opts.retainObjectPosition ?? false,
    retainObjectExit: opts.retainObjectExit ?? false,
    retainObjectNormal: opts.retainObjectNormal ?? false,
    retainWinnerPolygon: opts.retainWinnerPolygon ?? false,
    retainWinnerMesh: opts.retainWinnerMesh ?? false,
    retainAlbedoRgb: opts.retainAlbedoRgb ?? false,
    retainTargetRgb: opts.retainTargetRgb ?? false,
    ...(opts.depthBiases ? { depthBiases: opts.depthBiases } : {}),
    ...(opts.polygonMeshIds ? { polygonMeshIds: opts.polygonMeshIds } : {}),
    ...(opts.depthEpsilon ? { depthEpsilon: opts.depthEpsilon } : {}),
    ...(opts.occlusion ? { occlusion: opts.occlusion } : {}),
    ...(opts.textureSamplers ? { textureSamplers: opts.textureSamplers } : {}),
    ...(opts.transformCells ? { transformCells: opts.transformCells } : {}),
    ...(opts.solidWeightRamp ? { solidWeightRamp: opts.solidWeightRamp } : {}),
  };
}
