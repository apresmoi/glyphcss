/**
 * createGlyphScene — imperative scene API. The vanilla counterpart to
 * `<glyph-scene>` custom element.
 *
 * Mirrors glyphcss's `createPolyScene` architecturally:
 *   - Takes a host element + scene options, returns a `GlyphSceneHandle`.
 *   - `handle.add(polygons, transform?)` registers a mesh and returns a
 *     removable `GlyphMeshHandle`.
 *
 * DOM: injects `<div class="glyph-scene">` containing one `<pre>` (text
 * output) and one `<div class="glyph-hotspot-layer">` (positioned overlay
 * for hotspot dots).
 *
 * Paint backend: on each render, walks all registered meshes, applies each
 * mesh's transform to its polygons in memory, builds a `RasterizeContext`,
 * calls `rasterize`, and sets `<pre>.innerHTML` (or `.textContent` when
 * `useColors` is false).
 *
 * Camera changes trigger a re-rasterize; scene-root transform is NOT a CSS
 * matrix3d — the ASCII output bakes the camera rotation into the projected
 * text every render.
 */

import type {
  Vec3,
  RenderMode,
  Hotspot,
  Polygon,
  TextureSampler,
  GridSize,
} from "@glyphcss/core";
import { buildTextureSamplers, polygonTexture } from "@glyphcss/core";
import type { GlyphCamera } from "./createGlyphCamera";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { buildRasterizeContext, normalizeGlyphColorEncoding, normalizeGlyphColorTolerance } from "./rasterizeContext";
import type { ShadeCache, TemporalHistory } from "./rasterizeContext";
import { rasterize, rasterizeToCells, computeOcclusionIds } from "../render/rasterize";
import { encodeCellGridOutput, encodeGlyphBuffers, hasGlyphOutsideFontAtlas, type CellGrid, type GlyphColorEncoding, type TransformCells } from "../render/cells";
import {
  resolveGlyphControlLineage,
  validateGlyphControlMetadata,
  type GlyphControlPolygonLineage,
  type GlyphControlSceneManifest,
  type GlyphObjectDictionary,
} from "./controlFrame";
import type {
  GlyphEffectDefinitionLayerOptions,
  GlyphEffectLayerHandle,
  GlyphEffectParamSchema,
  GlyphEffectParamShape,
  GlyphEffectParamValues,
  GlyphEffectProgramLayerOptions,
} from "./effects";
import {
  composeRetainedGlyphEffectOutput,
  createRuntimeGlyphEffectLayer,
  prepareRuntimeGlyphEffectLayers,
  retainGlyphEffectOutput,
  type GlyphEffectOutputMetadata,
  type PreparedGlyphEffectLayer,
  type RetainedGlyphEffectOutput,
  type RuntimeGlyphEffectLayer,
} from "../render/effectCompositor";
import { injectGlyphBaseStyles, ensureGlyphAtlasFontFaceStyles } from "../styles/styles";
import { GLYPH_FONT_ATLAS, buildGlyphAtlasFontPaletteValuesCss } from "../render/fontAtlas";
import { createGlyphAtlasPaletteQuantizer, type GlyphAtlasPaletteInput, type GlyphAtlasPaletteQuantizer } from "../render/paletteQuantize";
import { projectHotspots } from "./projectHotspots";
import type { GlyphDirectionalLight, GlyphAmbientLight, GlyphMeshTransform, GlyphShadowOptions, GlyphSolidWeightRampStep } from "./types";
export type { GlyphMeshTransform, GlyphShadowOptions, GlyphSolidWeightRampStep } from "./types";

export interface GlyphSceneOptions {
  /** Render mode: "wireframe" | "solid". Default "solid". */
  mode?: RenderMode;
  /** Named glyph palette. Defaults to "default". */
  glyphPalette?: string;
  /**
   * Character encoding for rasterized output. `"ascii"` (default) is the
   * original ramp/rule-glyph encoding. `"braille"` renders wireframe mode
   * using Unicode Braille Patterns (U+2800..U+28FF) for smoother diagonal
   * and curved edges. Documented no-op in `solid`/`voxel`/`ink` modes — braille
   * dot coverage is binary and cannot carry a Lambert shade ramp or voxel
   * face glyph, so those modes always render ASCII regardless of this option.
   * `"halfblock"` is solid-mode-only: it packs two independently colored
   * subcells (top/bottom) into one `▀`/`▄`/`█` cell for 2× vertical color
   * resolution, at coarser shape. `"quadrant"` generalizes it to a full 2×2
   * subcell split (16 possible `▘▝▖▗▀▄▌▐▚▞█` + three-quadrant glyphs),
   * buying shape resolution AND, on a fully-covered cell, a two-color split
   * — twice halfblock's shape resolution at the same two-colors-per-cell
   * cost. Both are documented no-ops outside `solid` mode and when combined
   * with a `transformCells` hook or active `temporalBlend` reprojection. See
   * {@link RasterizeContextOptions.charMode}.
   */
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  /**
   * Box-drawing junction resolve pass (wireframe + `charMode: "ascii"` only).
   * When `true`, near-axis-aligned wireframe edges meeting in the same cell
   * resolve to a single `┌┐└┘├┤┬┴┼─│` glyph consistent with every edge that
   * touches it (corners, T-junctions, crossings) instead of a random per-tier
   * glyph. See {@link RasterizeContextOptions.wireframeJunctions}. Default
   * `false`.
   */
  wireframeJunctions?: boolean;
  /**
   * Hidden-line removal for the wireframe path (wireframe + `charMode:
   * "braille"`) and for `mode: "ink"`. `"show"` (default) is today's
   * behavior: edges/strokes draw with no depth reference. `"hide"`
   * depth-tests every stroke against a solid surface prepass so a back edge
   * (another mesh's or the same mesh's far side) doesn't paint through a
   * nearer one — wireframe with a slope-scaled margin, `ink` by exempting
   * each edge's own local vertex neighborhood so a mesh never self-occludes
   * its own silhouette. Documented no-op in `solid` (already depth-buffered
   * per cell). See {@link RasterizeContextOptions.hiddenLines}.
   */
  hiddenLines?: "show" | "hide";
  /**
   * Solid-mode-only second density axis: a font-weight-calibrated ramp of
   * (glyph, `font-weight`) steps ordered darkest → densest by measured ink
   * coverage — see `@glyphcss/effects`'s `calibrateWeightedGlyphRamp` and
   * {@link RasterizeContextOptions.solidWeightRamp}. When set, replaces
   * `glyphPalette`'s solid ramp so shading picks both a glyph and a weight,
   * buying more perceptual steps than glyph shape alone. Default `undefined`
   * (off, byte-identical). Documented no-op during active `temporalBlend`
   * reprojection.
   */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  /**
   * Row-wise greedy run-extension color merge tolerance (COLOR-TOLERANCE.md):
   * a run keeps extending while the next cell's true color is within
   * `colorTolerance` of the run's anchor color (redmean distance), trading
   * color fidelity for fewer `<span>`s — the lever that actually gates frame
   * rate for colored output. Default `0` = off, byte-identical. **Range is
   * 0..765, not 0..255** (black↔white is 764.83 under redmean). `NaN` and
   * negative values degrade to `0`; `+Infinity` is honored as-is (merges
   * every same-glyph run in a row). NOT gated behind `temporalBlend` —
   * measured with a control arm, tolerance pays off MOST under active TAA
   * reprojection (up to 4.5x span reduction). Documented no-op under
   * `glyphOutput: "semantic"` — semantic colors are exact class identifiers,
   * not shaded appearance, so merging them under a tolerance would corrupt
   * the lineage. See {@link RasterizeContextOptions.colorTolerance}.
   */
  colorTolerance?: number;
  /**
   * `"spans"` (default) is today's HTML-span run-coalescing encode path —
   * unset or `"spans"` is byte-identical to before this option existed.
   * `"atlas"` encodes `(glyph, colour)` as Private Use Area code points
   * against a checked-in COLR/CPAL colour font (see `render/fontAtlas.ts`),
   * producing ONE text node with zero `<span>`s — see AGENTS.md's
   * `colorEncoding` section for the measurement this follows.
   *
   * Does NOT require {@link atlasPalette}: with none supplied, the scene
   * derives and pools one itself (median-cut quantization over the frames it
   * renders — see `render/paletteQuantize.ts`), so a render with hundreds of
   * distinct Lambert-shaded colours encodes into 31 slots instead of falling
   * back. It falls back to `"spans"` for a frame whose glyphs aren't covered
   * by the atlas, or whose cells carry no usable colour (see
   * `isGlyphAtlasEncodable`, `render/cells.ts`) — a whole-scene decision,
   * never a per-cell mix. Documented no-op under `charMode:
   * "halfblock"`/`"quadrant"`, an active `solidWeightRamp` selection,
   * `glyphOutput: "semantic"`, and `useColors: false`. The atlas's
   * `@font-face`/`@font-palette-values` CSS and the `<pre>`'s
   * `font-family`/`font-palette` are wired automatically.
   * See {@link RasterizeContextOptions.colorEncoding}.
   */
  colorEncoding?: GlyphColorEncoding;
  /**
   * Fixed palette `colorEncoding: "atlas"` cells encode against — an ordered
   * `#rrggbb` array whose entries' POSITIONS (never their values) become the
   * PUA mapping's palette-slot axis. Cells whose colour isn't an exact entry
   * encode to their nearest one.
   *
   * `undefined` (the default) does NOT disable the atlas: it hands palette
   * derivation to the scene's own pooled quantizer, which is what a live
   * render normally wants. Supply an array only to pin the palette (a fixed
   * brand ramp, a reproducible bake) — see
   * {@link RasterizeContextOptions.atlasPalette}.
   */
  atlasPalette?: readonly string[];
  /** Whether to emit color spans. Default true. */
  useColors?: boolean;
  /** Grid columns. Default 80. */
  cols?: number;
  /** Grid rows. Default 24. */
  rows?: number;
  /** Character cell aspect ratio (height/width). Default 2.0. */
  cellAspect?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  camera?: GlyphCamera;
  /**
   * Smooth (Gouraud) shading. When `true`, per-pixel Lambert intensity is
   * interpolated from per-vertex normals averaged across adjacent polygons
   * within `creaseAngle`. Adjacent triangles on a curved surface render
   * without visible seams along their shared edges. Default `false` — the
   * faceted ASCII look is part of glyph's identity, so smooth shading is
   * opt-in. Turn it on for organic / curved-surface meshes (bread, sphere,
   * character models) where polygon seams hurt the silhouette.
   */
  smoothShading?: boolean;
  /**
   * Crease angle in degrees. With smooth shading on, adjacent faces whose
   * normals diverge by more than this angle stay flat-shaded at their shared
   * edge (preserves hard corners on otherwise smooth meshes). `0` reproduces
   * flat shading regardless of `smoothShading`; `180` smooths everything.
   * Default `60`.
   */
  creaseAngle?: number;
  /**
   * Render both faces of every polygon (no backface culling). Default `false`.
   * Set `true` for single-sided surfaces whose winding isn't guaranteed to face
   * the camera — e.g. BSP level geometry — so "back-wound" faces don't vanish,
   * matching how a CSS/DOM renderer shows both sides.
   * Lighting remains one-sided: the authored polygon normal is still used for
   * Lambert shading, so a backface does not get direct light via `abs(dot)`.
   */
  doubleSided?: boolean;
  /**
   * Supersampled anti-aliasing (solid mode). `1` (default) = off; `2`/`3`
   * rasterize at N× resolution and average down, removing the motion crawl of
   * sub-cell-sized surfaces. Cost ~N².
   */
  supersample?: number;
  /**
   * Global depth-test deadband (0 = exact, default). A polygon replaces a cell
   * only when nearer by more than this relative fraction, so near-coplanar
   * surfaces keep a stable winner instead of z-fighting per-cell as the camera
   * moves (the tearing a CSS/DOM renderer avoids via stacking order). 0.002–0.01.
   */
  depthEpsilon?: number;
  /**
   * Temporal anti-aliasing — exponential blend with the previous frame, weight
   * in [0,1). `0` (default) = off. Smooths fast frame-to-frame edge crawl that
   * supersampling can't cover, at the cost of motion ghosting.
   */
  temporalBlend?: number;
  /**
   * Auto-size the character grid to fill the host element. When `true`, the
   * scene measures one monospace character's pixel size from the live `<pre>`
   * (using whatever font size the host inherits via CSS), computes `cols` and
   * `rows` that fit the host's `clientWidth × clientHeight`, and re-fits on
   * host resize via a `ResizeObserver`. Default `false` — fixed `cols`/`rows`
   * (default 80×24) is the predictable choice for tests and SSR.
   */
  autoSize?: boolean;
  /**
   * Interactive level-of-detail. While a control is actively dragging (orbit /
   * pan / first-person), render the scene at `1/interactiveDownscale` resolution
   * (coarser glyphs, same on-screen size), snapping back to full detail on
   * release. `2` → ¼ the cells while dragging. `1` (default) disables it. Keeps
   * heavy high-resolution scenes smooth to drag without a permanent quality hit.
   */
  interactiveDownscale?: number;
  /** Shadow-map configuration. `undefined` (default) = no shadows. */
  shadow?: GlyphShadowOptions;
  /**
   * Optional post-rasterize cell hook (M4 composition effects). Runs on the
   * final glyph grid just before the single `<pre>` write; mutate cells or
   * return a new grid. `undefined` (default) → no grid is built and output is
   * byte-identical to the pre-hook renderer. See {@link TransformCells}.
   */
  transformCells?: TransformCells;
  /** Select the appearance-shaded or dictionary-semantic solid output. Default "visible". */
  glyphOutput?: "visible" | "semantic";
  /** Immutable polygon-to-surface lineage required only for `glyphOutput: "semantic"`. */
  sceneManifest?: GlyphControlSceneManifest;
  /** Immutable class-to-glyph/control-color dictionary required only for semantic output. */
  dictionary?: GlyphObjectDictionary;
}

export interface GlyphHotspotOptions {
  id: string;
  at: Vec3;
  size?: [number, number];
}

export interface GlyphHotspotHandle {
  remove(): void;
  /** The absolutely-positioned overlay `<div>` in the hotspot layer. */
  readonly el: HTMLElement;
}

export interface GlyphMeshHandle {
  readonly id: number;
  /** String identifier supplied via the `id` prop / transform option. */
  readonly name: string | undefined;
  /** The raw polygons registered with this mesh. */
  readonly polygons: Polygon[];
  setPolygons(polygons: Polygon[]): void;
  setTransform(transform: GlyphMeshTransform): void;
  dispose(): void;
}

export interface GlyphSceneHandle {
  /** The host element passed to `createGlyphScene`. */
  readonly host: HTMLElement;
  /** The `<pre>` element for reading rendered text output. */
  readonly output: HTMLPreElement;
  /** The camera attached to this scene (mutate then call `rerender()`). */
  readonly camera: GlyphCamera;
  /**
   * Register a polygon list as a mesh. Optionally supply a transform.
   * Returns a handle to update or dispose the mesh.
   */
  add(polygons: Polygon[], transform?: GlyphMeshTransform): GlyphMeshHandle;
  addEffectLayer<Schema extends GlyphEffectParamSchema, State = undefined>(
    options: GlyphEffectDefinitionLayerOptions<Schema, State>,
  ): GlyphEffectLayerHandle<GlyphEffectParamValues<Schema>>;
  addEffectLayer<P extends GlyphEffectParamShape<P>, State = undefined>(
    options: GlyphEffectProgramLayerOptions<P, State>,
  ): GlyphEffectLayerHandle<P>;
  addHotspot(opts: GlyphHotspotOptions, onClick?: () => void): GlyphHotspotHandle;
  /** Force an immediate re-rasterize. Normally called automatically on add/remove/setOptions. */
  rerender(): void;
  setOptions(opts: Partial<GlyphSceneOptions>): void;
  getOptions(): GlyphSceneOptions;
  /**
   * Read the last committed base-grid semantic winners. `null` unless semantic
   * output is active; detail-layer cells intentionally have no base-grid index.
   */
  getGlyphSemanticCellFrame(): GlyphSemanticCellFrame | null;
  /**
   * Re-measure the host's character cell (font-size, line-height) and adapt
   * `cols`/`rows`/`cellAspect`. Only meaningful when `autoSize` was enabled.
   * Call when something outside the scene options changes the cell size —
   * e.g., the consumer overrode `pre.style.lineHeight` directly. The internal
   * `ResizeObserver` already handles host-size changes automatically.
   */
  fit(): void;
  /**
   * Signal that an interaction (drag) is starting/ending. When
   * `interactiveDownscale > 1`, the scene renders coarser while active and
   * restores full detail on release. Controls call this automatically; only
   * needed manually for custom interaction sources.
   */
  setInteracting(active: boolean): void;
  destroy(): void;
}

export interface GlyphSemanticCellLineage {
  readonly polygonIndex: number;
  readonly surfaceId: string;
  readonly instanceId: string;
  readonly classId: number;
  readonly className: string;
  readonly semanticGlyph: string;
  readonly controlColor: string;
}

export interface GlyphSemanticCellFrame {
  readonly cols: number;
  readonly rows: number;
  /** Base-grid resolved depth winners, row-major. Empty cells are null. */
  readonly cells: readonly (GlyphSemanticCellLineage | null)[];
}

interface MeshEntry {
  id: number;
  polygons: Polygon[];
  transform: GlyphMeshTransform;
}

interface DetailLayerState {
  pre: HTMLPreElement;
  key: string;
  cw: number;
  ch: number;
  fontSize: string;
  lineHeight: string;
  transform: string;
}

interface DetailCommit {
  next: Map<number, DetailLayerState>;
  removed: DetailLayerState[];
}

interface StagedHotspotStyle { el: HTMLElement; display: string; left?: string; top?: string; zIndex?: string }

interface RenderCommit {
  /**
   * `atlas` is what the encoder actually PRODUCED for this node, not what
   * `colorEncoding` asked for — `commitRender` pins the atlas font family from
   * it. See `setGlyphAtlasFontOn`.
   */
  writes: Array<{ pre: HTMLPreElement; encoded: string; atlas: boolean }>;
  details: DetailCommit;
  hotspots: StagedHotspotStyle[];
  retained: Map<string, RetainedGlyphEffectOutput> | null;
}

type InternalOptions = Omit<Required<GlyphSceneOptions>, "shadow" | "transformCells" | "sceneManifest" | "dictionary" | "solidWeightRamp" | "atlasPalette"> & {
  shadow: GlyphShadowOptions | undefined;
  transformCells: TransformCells | undefined;
  sceneManifest: GlyphControlSceneManifest | undefined;
  dictionary: GlyphObjectDictionary | undefined;
  solidWeightRamp: GlyphSolidWeightRampStep[] | undefined;
  atlasPalette: readonly string[] | undefined;
};

let nextMeshId = 1;

// Module-level monotonic counter, never aliasing across scenes — same
// convention `nextMeshId` uses. Each scene that actually renders
// `colorEncoding: "atlas"` gets its own `@font-palette-values` custom ident,
// so two concurrent scenes with different palettes on the same document
// never fight over one shared name.
let nextAtlasStyleId = 1;

// Cell-metric probe character for an atlas-pinned `<pre>`: slot 0 / glyph 0,
// always present in the atlas cmap. Every atlas glyph carries the same advance
// (`build-atlas.py` gives them all the source face's "M" advance), so any code
// point in the range measures the same cell — see `measureCellOf`.
const ATLAS_METRIC_PROBE_CHAR = String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart);

// Convention aligned to voxcss/three.js: rotation is XYZ Euler in DEGREES,
// world frame. Matches voxcss core/src/math/rotation.ts `rotateVec3` (angles
// in degrees, composition M = Rx·Ry·Rz, Rz acts first on the point).
// glyphcss delta vs voxcss: output is baked world-space vertices (no CSS
// wrapper), so the CSS-frame swap/negate from voxcss PolyMesh.tsx
// `buildTransform` (rotateY(-rx)…) is NOT applied here — that is a
// CSS-frame artifact only.
function applyTransform(polygons: Polygon[], transform: GlyphMeshTransform): Polygon[] {
  const { position, scale, rotation } = transform;
  if (!position && !scale && !rotation) return polygons;

  const [px, py, pz] = position ?? [0, 0, 0];
  let sx = 1, sy = 1, sz = 1;
  if (scale !== undefined) {
    if (typeof scale === "number") { sx = sy = sz = scale; }
    else { [sx, sy, sz] = scale; }
  }
  // Degrees → radians. Rotation is [rxDeg, ryDeg, rzDeg] in world frame.
  const DEG2RAD = Math.PI / 180;
  const [rxDeg, ryDeg, rzDeg] = rotation ?? [0, 0, 0];
  const rx = rxDeg * DEG2RAD;
  const ry = ryDeg * DEG2RAD;
  const rz = rzDeg * DEG2RAD;

  // Compose rotation matrices: R = Rx(rx) * Ry(ry) * Rz(rz)
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

  function transformVertex(v: Vec3): Vec3 {
    // Scale
    let x = v[0] * sx, y = v[1] * sy, z = v[2] * sz;
    // Rz
    let nx = cosZ * x - sinZ * y;
    let ny = sinZ * x + cosZ * y;
    let nz = z;
    // Ry
    x = cosY * nx + sinY * nz;
    y = ny;
    z = -sinY * nx + cosY * nz;
    // Rx
    nx = x;
    ny = cosX * y - sinX * z;
    nz = sinX * y + cosX * z;
    // Translate
    return [nx + px, ny + py, nz + pz];
  }

  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(transformVertex),
    // Pre-transform positions, parallel to the new `vertices` — recovers the
    // mesh's own local frame for `space: "object"` effects without an
    // inverse-matrix pass. `p.vertices` is never mutated above (`.map`
    // returns a fresh array), so aliasing it here is safe and free.
    objectVertices: p.vertices,
  }));
}

export function createGlyphScene(
  host: HTMLElement,
  opts: GlyphSceneOptions = {},
): GlyphSceneHandle {
  const initialGlyphOutput = opts.glyphOutput ?? "visible";
  if (initialGlyphOutput !== "visible" && initialGlyphOutput !== "semantic") {
    throw new TypeError('glyphcss: glyphOutput must be "visible" or "semantic".');
  }
  if (initialGlyphOutput === "semantic") {
    if ((opts.mode ?? "solid") !== "solid") throw new RangeError("glyphcss: semantic glyph output requires solid mode.");
    if (!opts.sceneManifest || !opts.dictionary) {
      throw new TypeError("glyphcss: semantic glyph output requires sceneManifest and dictionary.");
    }
    validateGlyphControlMetadata(opts.sceneManifest, opts.dictionary);
  }
  injectGlyphBaseStyles(host.ownerDocument ?? undefined);

  const options: InternalOptions = {
    mode: opts.mode ?? "solid",
    glyphPalette: opts.glyphPalette ?? "default",
    charMode: opts.charMode ?? "ascii",
    wireframeJunctions: opts.wireframeJunctions ?? false,
    hiddenLines: opts.hiddenLines ?? "show",
    solidWeightRamp: opts.solidWeightRamp,
    colorTolerance: normalizeGlyphColorTolerance(opts.colorTolerance),
    colorEncoding: normalizeGlyphColorEncoding(opts.colorEncoding),
    atlasPalette: opts.atlasPalette,
    useColors: opts.useColors ?? true,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cellAspect: opts.cellAspect ?? 2.0,
    directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: opts.ambientLight ?? { intensity: 0.4 },
    camera: opts.camera ?? createGlyphPerspectiveCamera(),
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    interactiveDownscale: opts.interactiveDownscale ?? 1,
    depthEpsilon: opts.depthEpsilon ?? 0,
    temporalBlend: opts.temporalBlend ?? 0,
    autoSize: opts.autoSize ?? false,
    shadow: opts.shadow,
    transformCells: opts.transformCells,
    glyphOutput: initialGlyphOutput,
    sceneManifest: opts.sceneManifest,
    dictionary: opts.dictionary,
  };
  let committedOptions: InternalOptions = { ...options };

  function testRenderStage(stage: string): void {
    (globalThis as { __glyphRenderStage?: (stage: string) => void }).__glyphRenderStage?.(stage);
  }

  // Build DOM
  const sceneEl = host.ownerDocument!.createElement("div");
  sceneEl.className = "glyph-scene";
  const pre = host.ownerDocument!.createElement("pre") as HTMLPreElement;
  pre.className = "glyph-output";
  const hotspotLayer = host.ownerDocument!.createElement("div");
  hotspotLayer.className = "glyph-hotspot-layer";
  // Measurements happen in this permanent, invisible sibling.  In particular,
  // never append a probe to a published output: a failed render must not even
  // transiently mutate the output tree, and CSS units must be resolved by the
  // browser rather than guessed from parseFloat.
  const measurementSandbox = host.ownerDocument!.createElement("div");
  measurementSandbox.setAttribute("aria-hidden", "true");
  measurementSandbox.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;overflow:hidden;width:0;height:0;contain:layout style paint";
  sceneEl.appendChild(pre);
  sceneEl.appendChild(hotspotLayer);
  sceneEl.appendChild(measurementSandbox);
  host.appendChild(sceneEl);

  const meshes = new Map<number, MeshEntry>();
  const hotspots: Array<{ hotspot: Hotspot; el: HTMLElement; onClick?: () => void }> = [];
  let pendingRender = false;
  let renderGeneration = 0;
  let pendingEffectRender = false;
  let effectDirty = false;
  let destroyed = false;
  let nextEffectDeclarationOrder = 0;
  const effectLayers: RuntimeGlyphEffectLayer[] = [];
  let retainedEffectOutputs = new Map<string, RetainedGlyphEffectOutput>();
  let activePreparedEffects: readonly PreparedGlyphEffectLayer[] | null = null;
  let collectingEffectOutputs: Map<string, RetainedGlyphEffectOutput> | null = null;
  let currentEffectOutputMetadata: GlyphEffectOutputMetadata | null = null;
  let stagedFullEffectWrites: Array<{ pre: HTMLPreElement; encoded: string; atlas: boolean }> | null = null;
  let stagedDetailCommit: DetailCommit | null = null;
  let semanticCellFrame: GlyphSemanticCellFrame | null = null;
  // `colorEncoding: "atlas"` CSS wiring — see `syncGlyphAtlasStyles` below.
  // `atlasPaletteStyleEl` is this scene's OWN `@font-palette-values` block
  // (never shared across scenes, unlike the document-global `@font-face`);
  // `atlasPaletteName` is its custom ident, stable for the scene's lifetime
  // once allocated so a live palette-color edit updates the block in place
  // instead of re-pointing every already-styled `<pre>` at a new name.
  let atlasPaletteStyleEl: HTMLStyleElement | null = null;
  let atlasPaletteName: string | null = null;
  // Pooled palette quantizer, allocated lazily the first time a render
  // actually needs one — a `"spans"` scene (the default) never creates it and
  // never runs a line of quantization code. `options.atlasPalette`, when
  // supplied, wins outright: an explicitly pinned palette is the caller's,
  // and pooling it would silently override their choice.
  let atlasQuantizer: GlyphAtlasPaletteQuantizer | null = null;
  let atlasPaletteCssGeneration = -1;
  // The atlas WOFF2 is lazily imported (see `render/fontAtlas.ts`), so a scene
  // constructed with `colorEncoding: "atlas"` cannot encode PUA on its first
  // frame — the family does not exist yet and PUA would paint as tofu in the
  // fallback monospace face. This flips to `true` once the payload has loaded
  // AND the document reports the face decoded; until then the scene renders
  // through the ordinary span encoder, which is the correct fallback the
  // encoder already uses for any cell the atlas can't carry.
  let atlasFontReady = false;
  // Sticky per-scene latch for the OUT-OF-ATLAS-GLYPH fallback reason only —
  // distinct from `atlasFontReady`'s "the font hasn't arrived yet" reason,
  // which must keep flipping spans→atlas the instant the font loads (see the
  // critical distinction in AGENTS.md's `colorEncoding` section). The
  // wireframe path's own realized-vs-potential glyph set is already made
  // deterministic without this (see `isWireframePaletteAtlasEncodable`,
  // `render/rasterize.ts`) — this latch exists for what that structurally
  // CAN'T close: an animated effect or custom `transformCells` hook whose
  // realized glyph set varies frame to frame with data glyphcss cannot see in
  // advance (the dependency points the other way — `@glyphcss/effects`
  // depends on `glyphcss`, never the reverse). Once ANY output this scene
  // renders (base grid, a detail layer, or a retained effect layer) falls
  // back to spans for a glyph reason (`RasterizeContext.atlasGlyphFallback`,
  // or the CellGrid-path equivalent `hasGlyphOutsideFontAtlas` check below),
  // every later render stays spans until a `setOptions` call touching
  // `colorEncoding`, `atlasPalette`, `mode`, or `charMode` clears it.
  let atlasGlyphFallbackSticky = false;

  /**
   * Encoding this frame may actually use. Diverges from `options.colorEncoding`
   * during the lazy-font window (and permanently, if the payload failed to
   * load — see {@link atlasFontReady}), and once this scene has latched the
   * out-of-atlas-glyph fallback (see {@link atlasGlyphFallbackSticky}).
   */
  function effectiveColorEncoding(): GlyphColorEncoding {
    if (options.colorEncoding !== "atlas" || !atlasFontReady) return "spans";
    return atlasGlyphFallbackSticky ? "spans" : "atlas";
  }

  /**
   * Latch {@link atlasGlyphFallbackSticky} when this frame's atlas attempt
   * failed specifically because a glyph lacked an atlas outline — never for a
   * colour/palette-only reason, which is transient and not a configuration
   * problem. `attempted` must be THIS frame's `effectiveColorEncoding()`
   * result, captured before the render ran (not re-derived afterward, which
   * could itself already reflect a sticky flip this very call is deciding).
   */
  function noteAtlasGlyphFallback(attempted: GlyphColorEncoding, glyphFellBack: boolean): void {
    if (attempted === "atlas" && glyphFellBack) atlasGlyphFallbackSticky = true;
  }

  /**
   * Palette input for this render: the caller's fixed array if they pinned
   * one, otherwise the scene's own pooled quantizer. Only ever called from
   * the `colorEncoding: "atlas"` path, so the lazy allocation below cannot
   * fire for a `"spans"` scene — nor for an `"atlas"` scene whose font hasn't
   * arrived yet, which would pool a palette no `<pre>` is encoded against.
   */
  function activeAtlasPalette(): GlyphAtlasPaletteInput | undefined {
    if (effectiveColorEncoding() !== "atlas") return undefined;
    if (options.atlasPalette) return options.atlasPalette;
    return (atlasQuantizer ??= createGlyphAtlasPaletteQuantizer());
  }

  /**
   * Latch the pooled palette for the render transaction about to run. A scene
   * resolves the palette once per output `<pre>` — the base at the end of base
   * rasterization, each detail layer at the end of its own pass — so those
   * calls are separated by a whole raster pass, not "microseconds". Without
   * this latch a repool landing between them leaves the base `<pre>` encoded
   * against the OLD slots while the scene publishes the new palette to the
   * single `font-palette` ident every output shares, recolouring the base
   * wholesale — permanently, on a static scene.
   *
   * Allocates nothing for a `"spans"` scene, or for one with a pinned
   * `atlasPalette` (which cannot repool at all).
   */
  function beginAtlasPaletteTransaction(): void {
    if (effectiveColorEncoding() !== "atlas" || options.atlasPalette) return;
    (atlasQuantizer ??= createGlyphAtlasPaletteQuantizer()).beginTransaction();
  }

  function endAtlasPaletteTransaction(): void {
    atlasQuantizer?.endTransaction();
  }

  function hasEffectLayers(): boolean {
    return effectLayers.length > 0;
  }

  function effectRequests(requirement: "baseShade" | "normal" | "worldPosition" | "objectPosition" | "objectExit" | "objectNormal"): boolean {
    return effectLayers.some((layer) => (
      !layer.disposed && (
        layer.program.requirements?.includes(requirement) === true
        || layer.program.optionalRequirements?.includes(requirement) === true
        // Params-aware gating (VOLUMETRIC.md "Step 1"): re-evaluated against the
        // layer's LIVE params every render, so a requirement that only becomes
        // reachable under a particular param value (e.g. field-synth's carve
        // render mode) doesn't force every mounted instance to pay for it.
        || layer.program.dynamicRequirements?.(layer.paramsTarget).includes(requirement) === true
      )
    ));
  }

  // Any non-disposed layer whose target normalized to a mesh-id set
  // (VOLUMETRIC-3.md §1). Drives `retainWinnerMesh`: the winner-mesh buffer
  // is only worth computing/downsampling/exposing when at least one mounted
  // layer actually needs it to filter `targetCoverage`.
  function hasMeshTargetedLayers(): boolean {
    return effectLayers.some((layer) => !layer.disposed && layer.target instanceof Set);
  }

  function assertEffectMode(mode: RenderMode, layers = effectLayers): void {
    if (mode === "solid") return;
    for (const layer of layers) {
      const requirement = layer.program.requirements?.find((entry) => entry !== "baseColor");
      if (requirement) {
        throw new Error(`glyphcss: effect requirement "${requirement}" is only available in solid mode.`);
      }
    }
  }

  function runLegacyCellHook(grid: CellGrid): CellGrid {
    return options.transformCells?.(grid) ?? grid;
  }

  const transformEffectCells: TransformCells = (grid) => {
    if (!activePreparedEffects || !collectingEffectOutputs || !currentEffectOutputMetadata) {
      throw new Error("glyphcss: effect compositor ran outside an active render transaction.");
    }
    // Pool this output's pure working scratch across full geometry renders
    // (e.g. every frame of a camera orbit) by handing the LAST successfully
    // committed retained output for this same id, if any, to
    // `retainGlyphEffectOutput` as a reuse candidate — see that function's
    // own doc for why only its working-scratch fields are eligible and why
    // `retainedEffectOutputs` (not `collectingEffectOutputs`, which only
    // holds outputs already staged for the transaction IN PROGRESS) is the
    // right source: it is never mutated once a render commits, exactly the
    // "safe to hand out, never itself corrupted by a failed frame" contract
    // `retainGlyphEffectOutput` documents.
    const retained = retainGlyphEffectOutput(grid, currentEffectOutputMetadata, retainedEffectOutputs.get(currentEffectOutputMetadata.id));
    collectingEffectOutputs.set(currentEffectOutputMetadata.id, retained);
    return runLegacyCellHook(composeRetainedGlyphEffectOutput(retained, activePreparedEffects));
  };

  function writeOrStageFullOutput(outputPre: HTMLPreElement, encoded: string, atlas = false): void {
    if (!stagedFullEffectWrites) throw new Error("glyphcss: output write escaped its render transaction.");
    stagedFullEffectWrites.push({ pre: outputPre, encoded, atlas });
  }

  function renderRetainedEffects(): void {
    if (destroyed || !effectDirty) return;
    if (options.glyphOutput === "semantic") return;
    if (retainedEffectOutputs.size === 0) {
      scheduleRender();
      return;
    }
    assertEffectMode(options.mode);
    const prepared = prepareRuntimeGlyphEffectLayers(effectLayers, [options.cols, options.rows]);
    const staged: Array<{ output: RetainedGlyphEffectOutput; encoded: string; atlas: boolean }> = [];
    // Every output of this transaction must encode against ONE palette — see
    // `beginAtlasPaletteTransaction`.
    beginAtlasPaletteTransaction();
    try {
      for (const output of retainedEffectOutputs.values()) {
        testRenderStage("effect-compose");
        const grid = runLegacyCellHook(composeRetainedGlyphEffectOutput(output, prepared));
        const attemptedEncoding = effectiveColorEncoding();
        const encoded = encodeCellGridOutput(grid, options.useColors, options.colorTolerance, attemptedEncoding, activeAtlasPalette());
        // A generic effect program's realized glyph set is data-driven (the
        // active field value, an arbitrary custom program) — glyphcss cannot
        // see its potential set in advance, so this can only latch the
        // sticky fallback from the REALIZED grid, not gate on one up front
        // the way the wireframe path's own palette tiers can.
        if (encoded.encoding !== "atlas") {
          noteAtlasGlyphFallback(attemptedEncoding, hasGlyphOutsideFontAtlas(grid.char, grid.cols, grid.rows));
        }
        staged.push({ output, encoded: encoded.text, atlas: encoded.encoding === "atlas" });
      }
    } finally {
      endAtlasPaletteTransaction();
    }
    commitRender({
      writes: staged.map(({ output, encoded, atlas }) => ({ pre: output.metadata.pre, encoded, atlas })),
      details: { next: new Map(detailLayers), removed: [] },
      hotspots: [],
      retained: retainedEffectOutputs,
    });
    effectDirty = false;
    if (!hasEffectLayers()) retainedEffectOutputs.clear();
  }

  function scheduleEffectRender(): void {
    effectDirty = true;
    if (destroyed || pendingEffectRender) return;
    pendingEffectRender = true;
    Promise.resolve().then(() => {
      pendingEffectRender = false;
      if (destroyed || pendingRender || !effectDirty) return;
      try {
        renderRetainedEffects();
      } catch (error) {
        // Test harnesses can observe an async retained-frame failure without
        // turning it into an unrelated unhandled-rejection failure. This is a
        // private global seam, intentionally absent from the public API.
        const report = (globalThis as { __glyphRenderError?: (error: unknown) => void }).__glyphRenderError;
        if (report) report(error); else throw error;
      }
    });
  }

  // Cross-frame shading cache: per-triangle Lambert intensities + lit color are
  // camera-invariant, so they survive a camera-only re-render (orbit/zoom drag)
  // and only need clearing when geometry, transforms, or lighting/shading
  // options change. Shadow changes do NOT invalidate it — shadows are blended
  // per cell at scan-fill, not baked into the cached lit color.
  const shadeCache: ShadeCache = { iA: [], iB: [], iC: [], lit: [] };
  // Retained previous-frame buffer for temporal AA; `rasterize` resizes/seeds it.
  const temporalHistory: TemporalHistory = {
    idx: new Float32Array(0), r: new Float32Array(0), g: new Float32Array(0), b: new Float32Array(0), cols: 0, rows: 0, cam: null,
  };
  // Never destroy a committed cache before the render which invalidates it has
  // itself committed. A later-stage failure must leave both the frame and its
  // next-frame inputs exactly as they were.
  let shadeCacheDirty = false;
  function invalidateShading(): void { shadeCacheDirty = true; }

  function cloneShadeCache(source: ShadeCache): ShadeCache {
    return { iA: source.iA.slice(), iB: source.iB.slice(), iC: source.iC.slice(), lit: source.lit.slice() };
  }

  function cloneTemporalHistory(source: TemporalHistory): TemporalHistory {
    return {
      idx: source.idx.slice(), r: source.r.slice(), g: source.g.slice(), b: source.b.slice(),
      cols: source.cols, rows: source.rows,
      cam: source.cam === null ? null : {
        ...source.cam,
        target: [...source.cam.target] as [number, number, number],
        center: [...source.cam.center] as [number, number],
        metrics: source.cam.metrics ? { ...source.cam.metrics } : undefined,
      },
    };
  }

  function publishRendererState(nextShadeCache: ShadeCache, nextTemporalHistory: TemporalHistory): void {
    shadeCache.iA.splice(0, shadeCache.iA.length, ...nextShadeCache.iA);
    shadeCache.iB.splice(0, shadeCache.iB.length, ...nextShadeCache.iB);
    shadeCache.iC.splice(0, shadeCache.iC.length, ...nextShadeCache.iC);
    shadeCache.lit.splice(0, shadeCache.lit.length, ...nextShadeCache.lit);
    temporalHistory.idx = nextTemporalHistory.idx;
    temporalHistory.r = nextTemporalHistory.r;
    temporalHistory.g = nextTemporalHistory.g;
    temporalHistory.b = nextTemporalHistory.b;
    temporalHistory.cols = nextTemporalHistory.cols;
    temporalHistory.rows = nextTemporalHistory.rows;
    temporalHistory.cam = nextTemporalHistory.cam;
    shadeCacheDirty = false;
  }

  // Decoded texture pixel samplers (for per-cell texture rendering). Built async
  // from all mesh polygons that carry a texture; null until decoded / when none.
  // Polygons without a texture+uvs simply render flat, so this is a no-op cost
  // for untextured scenes.
  let textureSamplers: Map<string, TextureSampler> | null = null;
  let textureToken = 0;
  let textureSamplerKey = "";
  function refreshTextureSamplers(): void {
    const polys: Polygon[] = [];
    const urls = new Set<string>();
    for (const entry of meshes.values()) {
      for (const p of entry.polygons) {
        const texture = polygonTexture(p);
        if (!texture) continue;
        urls.add(texture);
        polys.push(p);
      }
    }
    const nextKey = [...urls].sort().join("\n");
    if (!nextKey) {
      textureToken += 1;
      textureSamplerKey = "";
      if (textureSamplers) {
        textureSamplers = null;
        scheduleRender();
      }
      return;
    }
    if (nextKey === textureSamplerKey) return;
    textureSamplerKey = nextKey;
    const token = ++textureToken;
    void buildTextureSamplers(polys).then((map) => {
      if (token !== textureToken) return; // superseded by a newer mesh change
      textureSamplers = map.size > 0 ? map : null;
      scheduleRender();
    });
  }

  function scheduleRender(): void {
    if (destroyed || pendingRender) return;
    pendingRender = true;
    const generation = ++renderGeneration;
    Promise.resolve().then(() => {
      if (generation !== renderGeneration) return;
      pendingRender = false;
      if (destroyed) return;
      doRender();
    });
  }

  function resolveSemanticLineage(polygons: readonly Polygon[]): readonly GlyphControlPolygonLineage[] {
    if (!options.sceneManifest || !options.dictionary) {
      throw new TypeError("glyphcss: semantic glyph output requires sceneManifest and dictionary.");
    }
    return resolveGlyphControlLineage(polygons, options.sceneManifest, options.dictionary).lineage;
  }

  function encodeSemanticCells(
    cells: CellGrid,
    lineage: readonly GlyphControlPolygonLineage[],
    winnerToGlobal: readonly number[],
    useColors: boolean,
  ): string {
    const n = cells.cols * cells.rows;
    const chars = new Array<string>(n).fill(" ");
    const colors = new Array<string | null>(n).fill(null);
    const winners = cells.winnerPolygon;
    if (!winners) throw new Error("glyphcss: semantic output requires winner polygon cells.");
    for (let index = 0; index < n; index++) {
      const winner = winners[index]!;
      if (winner < 0) continue;
      const globalWinner = winnerToGlobal[winner];
      const resolved = globalWinner === undefined ? undefined : lineage[globalWinner];
      if (!resolved) throw new RangeError(`glyphcss: raster winner ${globalWinner ?? winner} is outside the semantic lineage.`);
      chars[index] = resolved.semanticGlyph;
      colors[index] = resolved.controlColor;
    }
    return encodeGlyphBuffers(chars, colors, cells.cols, cells.rows, useColors);
  }

  function doRender(): void {
    try {
      doRenderTransaction();
    } catch (error) {
      // Preparation (semantic validation, layout measurement, occlusion and
      // effect setup) is part of the same option transaction as publication.
      Object.assign(options, committedOptions);
      throw error;
    }
  }

  function doRenderTransaction(): void {
    if (destroyed) return;
    if (options.glyphOutput === "semantic" && options.mode !== "solid") {
      throw new RangeError("glyphcss: semantic glyph output requires solid mode.");
    }
    // Gather all polygons after transforms.
    const allPolygons: Polygon[] = [];
    const basePolygonGlobalIndexes: number[] = [];
    const basePolygonMeshIds: number[] = [];
    const castShadowFlags: boolean[] = [];
    const receiveShadowFlags: boolean[] = [];
    const depthBiases: number[] = [];
    let anyDepthBias = false;
    const detailEntries: MeshEntry[] = [];
    const transformedByEntry = new Map<number, Polygon[]>();
    const globalPolygonOffsets = new Map<number, number>();
    const semanticPolygons: Polygon[] = [];
    for (const entry of meshes.values()) {
      const transformed = applyTransform(entry.polygons, entry.transform);
      globalPolygonOffsets.set(entry.id, semanticPolygons.length);
      semanticPolygons.push(...transformed);
      transformedByEntry.set(entry.id, transformed);
      // Meshes with their own cell metrics render in a separate, finer <pre>.
      if (isDetailMesh(entry.transform)) { detailEntries.push(entry); continue; }
      const cast = entry.transform.castShadow ?? false;
      const receive = entry.transform.receiveShadow ?? false;
      const bias = entry.transform.depthBias ?? 0;
      if (bias !== 0) anyDepthBias = true;
      const globalOffset = globalPolygonOffsets.get(entry.id)!;
      for (let polygonIndex = 0; polygonIndex < transformed.length; polygonIndex++) {
        const p = transformed[polygonIndex]!;
        allPolygons.push(p);
        basePolygonGlobalIndexes.push(globalOffset + polygonIndex);
        basePolygonMeshIds.push(entry.id);
        castShadowFlags.push(cast);
        receiveShadowFlags.push(receive);
        depthBiases.push(bias);
      }
    }

    // Validate every semantic prerequisite before allocating a winner buffer,
    // projecting geometry, creating detail DOM, or assigning any output.
    const semanticLineage = options.glyphOutput === "semantic"
      ? (semanticPolygons.length > 0 ? resolveSemanticLineage(semanticPolygons) : [])
      : null;

    // Cross-layer occlusion: if any OPAQUE detail mesh exists, build ONE shared
    // camera-depth buffer (base meshes + opaque detail meshes) at the base grid.
    // Each opaque layer then blanks cells where another layer is nearer. Transparent
    // detail meshes don't participate (they neither occlude nor are occluded).
    // Layer ids: base meshes share id 0; each opaque detail mesh uses its own id.
    const BASE_LAYER = 0;
    const baseGrid = baseProjectionGrid();
    let occShared: { idMap: Int32Array; cols: number; rows: number; ss: number; cwB: number; chB: number } | null = null;
    const opaqueDetails = detailEntries.filter((e) => e.transform.transparent !== true);
    if (opaqueDetails.length > 0) {
      const baseCell = baseCellMetrics();
      const bc = { w: baseGrid.cellWidth ?? baseCell.w, h: baseGrid.cellHeight ?? baseCell.h };
      if (bc.w > 0 && bc.h > 0) {
        // Build the id-map at the scene's supersample so the world's supersampled
        // silhouette and its id-map hole coincide (no world/entity boundary seam).
        const ss = options.supersample && options.supersample > 1 ? Math.floor(options.supersample) : 1;
        const groups: { polygons: Polygon[]; id: number }[] = [{ polygons: allPolygons, id: BASE_LAYER }];
        for (const e of opaqueDetails) groups.push({ polygons: applyTransform(e.polygons, e.transform), id: e.id });
        const idMap = computeOcclusionIds(groups, options.camera, options.cols, options.rows, options.cellAspect, ss, baseGrid);
        occShared = { idMap, cols: options.cols * ss, rows: options.rows * ss, ss, cwB: bc.w, chB: bc.h };
      }
    }

    assertEffectMode(options.mode);
    // Semantic output is geometry identity, never appearance composition. Keep
    // retained effects and hooks untouched so visible mode resumes exactly.
    const effectsActive = options.glyphOutput === "visible" && hasEffectLayers();
    const retainBaseShade = effectsActive && effectRequests("baseShade");
    const retainWorldPosition = effectsActive && effectRequests("worldPosition");
    const retainNormal = effectsActive && effectRequests("normal");
    const retainObjectPosition = effectsActive && effectRequests("objectPosition");
    const retainObjectExit = effectsActive && effectRequests("objectExit");
    const retainObjectNormal = effectsActive && effectRequests("objectNormal");
    // Per-object effect targeting (VOLUMETRIC-3.md §1): the winner-mesh
    // buffer only needs to be downsampled/exposed when a mounted layer's
    // target actually normalized to a mesh-id set — ORed with
    // `retainObjectExit`'s own (internal, never-exposed) need for the same
    // buffer at `polygonMeshIds`-supply time, below.
    const retainWinnerMesh = effectsActive && hasMeshTargetedLayers();
    let worldToSceneScale: number | undefined;
    if (retainWorldPosition) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const include = (polygons: readonly Polygon[]) => {
        for (const polygon of polygons) for (const vertex of polygon.vertices) {
          if (vertex[0] < minX) minX = vertex[0];
          if (vertex[1] < minY) minY = vertex[1];
          if (vertex[2] < minZ) minZ = vertex[2];
          if (vertex[0] > maxX) maxX = vertex[0];
          if (vertex[1] > maxY) maxY = vertex[1];
          if (vertex[2] > maxZ) maxZ = vertex[2];
        }
      };
      include(allPolygons);
      for (const entry of detailEntries) include(applyTransform(entry.polygons, entry.transform));
      const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      worldToSceneScale = Number.isFinite(span) && span > 1e-9
        ? Math.min(options.cols, options.rows) / span
        : 1;
    }
    activePreparedEffects = effectsActive
      ? prepareRuntimeGlyphEffectLayers(effectLayers, [options.cols, options.rows])
      : null;
    collectingEffectOutputs = effectsActive ? new Map() : null;
    // Every output is staged, including the ordinary no-effect fast path.
    // This is deliberately not conditional: detail insertion/style and base
    // text are one visible transaction.
    stagedFullEffectWrites = [];
    // The base `<pre>` and every detail `<pre>` of this frame must encode
    // against ONE palette — they share one `font-palette` ident.
    beginAtlasPaletteTransaction();
    // Rasterization is allowed to mutate these working copies freely. They
    // become the next frame's state only after every output/detail/hotspot
    // publication succeeds.
    const nextShadeCache = shadeCacheDirty
      ? { iA: [], iB: [], iC: [], lit: [] }
      : cloneShadeCache(shadeCache);
    const nextTemporalHistory = cloneTemporalHistory(temporalHistory);

    try {
    testRenderStage("base-validate");
    testRenderStage("base-layout");
    const ctx = buildRasterizeContext({
      camera: options.camera,
      grid: baseGrid,
      polygons: allPolygons,
      mode: options.mode,
      directionalLight: options.directionalLight,
      ambientLight: options.ambientLight,
      glyphPalette: options.glyphPalette,
      charMode: options.charMode,
      wireframeJunctions: options.wireframeJunctions,
      hiddenLines: options.hiddenLines,
      solidWeightRamp: options.solidWeightRamp,
      colorTolerance: options.colorTolerance,
      colorEncoding: effectiveColorEncoding(),
      atlasPalette: activeAtlasPalette(),
      useColors: options.useColors,
      smoothShading: options.smoothShading,
      creaseAngle: options.creaseAngle,
      doubleSided: options.doubleSided,
      supersample: options.supersample,
      depthEpsilon: options.depthEpsilon,
      temporalBlend: options.temporalBlend,
      shadow: options.shadow,
      castShadowFlags,
      receiveShadowFlags,
      depthBiases: anyDepthBias ? depthBiases : undefined,
      polygonMeshIds: (retainObjectExit || retainWinnerMesh) ? basePolygonMeshIds : undefined,
      retainShade: retainBaseShade,
      retainWorldPosition,
      retainNormal,
      retainObjectPosition,
      retainObjectExit,
      retainObjectNormal,
      retainWinnerMesh,
      retainWinnerPolygon: options.glyphOutput === "semantic",
    });
    ctx.shadeCache = nextShadeCache;
    ctx.textureSamplers = textureSamplers;
    if (options.glyphOutput === "visible") ctx.temporalHistory = nextTemporalHistory;
    // Base layer maps its internal (supersampled) cell 1:1 onto the id-map (also
    // built at ss): colScale=ss cancels the mask's 1/ss, so internal cell → id-map cell.
    ctx.occlusion = occShared
      ? { idMap: occShared.idMap, layerId: BASE_LAYER, cols: occShared.cols, rows: occShared.rows, colScale: occShared.ss, colOffset: 0.5, rowScale: occShared.ss, rowOffset: 0.5 }
      : null;
    currentEffectOutputMetadata = effectsActive ? {
      id: "base",
      pre,
      isBase: true,
      cellToSceneGrid: [1, 0, 0, 1, 0, 0],
      sceneGridSize: [options.cols, options.rows],
      localCellFootprint: [1, 1],
      ...(worldToSceneScale !== undefined ? { worldToSceneScale } : {}),
    } : null;
    // With no effect layer, preserve the direct legacy/no-hook byte path.
    ctx.transformCells = options.glyphOutput === "visible"
      ? (effectsActive ? transformEffectCells : options.transformCells)
      : undefined;

    // Optional perf instrumentation: set `globalThis.__glyphPerf = {}` to
    // record per-render rasterize vs DOM-write timings into it. Zero cost when
    // the flag is unset. Used by the glyphcss perf benchmark to decide whether
    // the bottleneck is JS rasterization or the DOM/paint of the <pre>.
    const perf = (globalThis as { __glyphPerf?: { raster?: number[]; dom?: number[]; polys?: number[] } }).__glyphPerf;
    const tStart = perf ? performance.now() : 0;

    testRenderStage("base-project");
    testRenderStage("base-raster");
    const semanticCells = options.glyphOutput === "semantic" ? rasterizeToCells(ctx) : null;
    const output = semanticCells
      ? encodeSemanticCells(semanticCells, semanticLineage!, basePolygonGlobalIndexes, options.useColors)
      : rasterize(ctx);
    // Build the immutable inspection snapshot before any DOM publication. A
    // malformed lineage must fail this render transaction, not leave text
    // advanced while its inspector frame remains stale.
    const nextSemanticCellFrame = semanticCells
      ? buildSemanticCellFrame(semanticCells, semanticLineage!, basePolygonGlobalIndexes)
      : null;
    testRenderStage("base-encode");
    const tRaster = perf ? performance.now() : 0;

    writeOrStageFullOutput(pre, output, ctx.atlasEncoded);
    noteAtlasGlyphFallback(ctx.colorEncoding, ctx.atlasGlyphFallback);

    if (perf) {
      const tDom = performance.now();
      (perf.raster ??= []).push(tRaster - tStart);
      (perf.dom ??= []).push(tDom - tRaster);
      (perf.polys ??= []).push(allPolygons.length);
    }

    // Detail meshes — each in its own finer, translated <pre> overlay.
    renderDetailLayers(
      detailEntries,
      occShared,
      baseGrid,
      retainBaseShade,
      retainWorldPosition,
      retainNormal,
      retainObjectPosition,
      retainObjectExit,
      retainObjectNormal,
      retainWinnerMesh,
      worldToSceneScale,
      semanticLineage,
      globalPolygonOffsets,
      transformedByEntry,
    );

    // Nothing above this line publishes a detail node, style, transform, or
    // encoded frame. A failed projection/encode therefore leaves the prior
    // scene intact instead of exposing a half-rendered set of layers.
    const hotspotStyles = stageHotspots();
    commitRender({
      writes: stagedFullEffectWrites,
      details: stagedDetailCommit ?? { next: new Map(detailLayers), removed: [] },
      hotspots: hotspotStyles,
      retained: options.glyphOutput === "visible" ? (collectingEffectOutputs ?? new Map()) : null,
    });
    publishRendererState(nextShadeCache, nextTemporalHistory);
    semanticCellFrame = nextSemanticCellFrame;
    effectDirty = false;
    committedOptions = { ...options };
    } catch (error) {
      // Option setters schedule their render asynchronously. Keep their public
      // state coupled to the DOM transaction when a later preparation stage
      // rejects instead of leaving semantic/visible selection ahead of paint.
      throw error;
    } finally {
      endAtlasPaletteTransaction();
      currentEffectOutputMetadata = null;
      collectingEffectOutputs = null;
      activePreparedEffects = null;
      stagedFullEffectWrites = null;
      stagedDetailCommit = null;
    }
  }

  function buildSemanticCellFrame(cells: CellGrid, lineage: readonly GlyphControlPolygonLineage[], winnerToGlobal: readonly number[]): GlyphSemanticCellFrame {
    const winners = cells.winnerPolygon;
    if (!winners || !options.sceneManifest || !options.dictionary) throw new Error("glyphcss: semantic cell frame requires semantic output metadata.");
    const surfaces = new Map(options.sceneManifest.surfaces.map((surface) => [surface.id, surface]));
    const instances = new Map(options.sceneManifest.instances.map((instance) => [instance.id, instance]));
    const classes = new Map(options.dictionary.classes.map((entry) => [entry.id, entry]));
    const cellsOut = Array.from(winners, (winner): GlyphSemanticCellLineage | null => {
      if (winner < 0) return null;
      const polygonIndex = winnerToGlobal[winner];
      const resolved = polygonIndex === undefined ? undefined : lineage[polygonIndex];
      if (!resolved) return null;
      const surfaceId = options.sceneManifest!.polygonSurfaceIds[polygonIndex]!;
      const surface = surfaces.get(surfaceId);
      const instance = surface ? instances.get(surface.instanceId) : undefined;
      const entry = instance ? classes.get(instance.classId) : undefined;
      return surface && instance && entry
        ? Object.freeze({ polygonIndex, surfaceId, instanceId: instance.id, classId: entry.id, className: entry.name, semanticGlyph: entry.semanticGlyph, controlColor: entry.controlColor })
        : null;
    });
    return Object.freeze({ cols: cells.cols, rows: cells.rows, cells: Object.freeze(cellsOut) });
  }

  // A mesh "pops out" into its own <pre> when it declares its own cell metrics OR
  // asks to be transparent (a shared-pre mesh always occludes — one depth buffer —
  // so non-occlusion requires its own layer).
  function isDetailMesh(t: GlyphMeshTransform): boolean {
    return (t.density != null && t.density !== 1) || t.fontSize != null || t.lineHeight != null || t.transparent === true;
  }

  // Measure one monospace cell (px) from a live <pre>, honoring its inherited /
  // overridden font-size + line-height. Multi-line probe so sub-1 line-heights
  // measure the true per-line advance (see measureCell for the rationale).
  function measureCellOf(el: HTMLElement): { w: number; h: number; measured: boolean } {
    const LINES = 20;
    const probe = host.ownerDocument!.createElement("pre");
    probe.className = el.className;
    // Probe with a character the ACTIVE font actually resolves. "M" is not in
    // the atlas cmap, so probing an atlas-pinned `<pre>` with it measured the
    // fallback `monospace` advance while the node painted at the atlas's —
    // silently wrong `autoSize` fit, hotspot placement and detail-layer
    // transforms on every platform whose `monospace` isn't the atlas's own
    // source face. A PUA code point resolves from the atlas, and every atlas
    // glyph (space included) carries the same advance.
    const probeChar = el.style.fontFamily.includes(GLYPH_FONT_ATLAS.family) ? ATLAS_METRIC_PROBE_CHAR : "M";
    probe.textContent = Array(LINES).fill(probeChar).join("\n");
    // Resolve the actual browser cascade (including calc/var/em/normal) in a
    // permanent hidden sibling instead of parsing a CSS string or touching a
    // published output node during preparation.
    probe.style.cssText = el.style.cssText + ";position:absolute;visibility:hidden;white-space:pre;padding:0;margin:0;pointer-events:none";
    measurementSandbox.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    const measured = r.width > 0 && r.height > 0;
    return { w: r.width || 8, h: r.height ? r.height / LINES : 16, measured };
  }

  // Cell-size measurements force a synchronous layout flush, so they're cached and
  // only refreshed when the cell metrics actually change — NOT per camera frame.
  // Base cache invalidated by fit()/setOptions; per-detail cache keyed on its
  // font-size+line-height.
  let baseCellCache: { w: number; h: number; measured: boolean } | null = null;
  function baseCellMetrics(): { w: number; h: number; measured: boolean } {
    return (baseCellCache ??= measureCellOf(pre));
  }
  // Memoizes `measureDetailCell` itself, in addition to (not instead of) each
  // detail layer's own `layer.key` gate above: the MAX_DIM cap below (~1636)
  // forces that per-layer key to keep re-deriving every frame the cap is
  // engaged — bbox size is genuinely per-frame, so the key can't just hold —
  // and for a mesh whose own font diverges from the base's, that re-derive
  // calls this function again with the EXACT SAME (fontSize, lineHeight,
  // fontFamily) triple every time (density/cwB/chB/sameFontAsBase are
  // unchanged; only the cap's downstream arithmetic varies). Without this,
  // that becomes one real hidden-`<pre>` layout probe (a forced synchronous
  // flush) per steady-state rerender, indefinitely — this memo turns the
  // repeat calls into a cache hit, since the same CSS input is a pure
  // function of layout on a given document. Cleared on `scene.destroy()`.
  const detailCellMeasureCache = new Map<string, { w: number; h: number; measured: boolean }>();
  function measureDetailCell(fontSize: string, lineHeight: string, fontFamily: string): { w: number; h: number; measured: boolean } {
    const key = `${fontSize}\n${lineHeight}\n${fontFamily}`;
    const cached = detailCellMeasureCache.get(key);
    if (cached) return cached;
    const candidate = host.ownerDocument!.createElement("pre");
    candidate.className = "glyph-output glyph-output--detail";
    candidate.style.cssText = "position:absolute;top:0;left:0;margin:0;transform-origin:top left;pointer-events:none";
    candidate.style.fontSize = fontSize;
    candidate.style.lineHeight = lineHeight;
    // Measure in the same font stack the detail `<pre>` is actually painting
    // in — see `measureCellOf`'s probe-character note.
    if (fontFamily) candidate.style.fontFamily = fontFamily;
    const result = measureCellOf(candidate);
    detailCellMeasureCache.set(key, result);
    return result;
  }
  function baseProjectionGrid(): GridSize {
    const cell = baseCellMetrics();
    const grid: GridSize = {
      cols: options.cols,
      rows: options.rows,
      cellAspect: options.cellAspect,
    };
    if (cell.measured) {
      grid.cellWidth = cell.w;
      grid.cellHeight = cell.h;
    }
    if (options.autoSize && cell.measured && cell.w > 0 && cell.h > 0) {
      const r = host.getBoundingClientRect();
      if (r.width > 0) {
        grid.centerCol = options.cols * options.camera.center[0] + (r.width - options.cols * cell.w) / (2 * cell.w);
      }
      if (r.height > 0) {
        grid.centerRow = options.rows * options.camera.center[1] + (r.height - options.rows * cell.h) / (2 * cell.h);
      }
    }
    return grid;
  }
  let baseFontPxCache: number | null = null;
  function baseFontPx(): number {
    return (baseFontPxCache ??= parseFloat((host.ownerDocument!.defaultView ?? globalThis).getComputedStyle(pre).fontSize) || 13);
  }
  const detailLayers = new Map<number, DetailLayerState>();

  // Apply (or clear) the atlas font stack on one output `<pre>`, driven by
  // whether the string being committed to it was REALLY atlas-encoded — not
  // by whether `colorEncoding: "atlas"` was requested.
  //
  // The difference is load-bearing, and the original "safe unconditionally"
  // reasoning was wrong. The atlas cmap covers `U+0020` as well as its own PUA
  // range (`build-atlas.py`: `cmap = {0x0020: "space"}`, needed because an
  // atlas-encoded grid writes blank cells as literal spaces and they must come
  // from the same face as the PUA cells). So on a frame that fell back to
  // spans — the pre-ready window, `charMode: "braille"`, an exotic wireframe
  // palette, an out-of-atlas field-synth ramp glyph — a pinned family resolves
  // that frame's SPACES from the atlas at the atlas's own advance and every
  // other character from the platform `monospace`. Two fonts, one grid.
  // Invisible on macOS (`monospace` IS the atlas's source face there) and
  // measured broken elsewhere: 40 spaces 394.92px vs 40 "M" 393.67px in
  // Chromium/WebKit, 389px vs 537px against a proportional fallback, ~9% per
  // space where `monospace` maps to Consolas.
  function setGlyphAtlasFontOn(preEl: HTMLPreElement, atlasEncoded: boolean): void {
    if (atlasEncoded) {
      preEl.style.fontFamily = `"${GLYPH_FONT_ATLAS.family}", monospace`;
      if (atlasPaletteName) preEl.style.setProperty("font-palette", atlasPaletteName);
      else preEl.style.removeProperty("font-palette");
    } else {
      preEl.style.removeProperty("font-family");
      preEl.style.removeProperty("font-palette");
    }
  }

  /** Is the atlas family currently the first entry of this `<pre>`'s font stack? */
  function isGlyphAtlasPinned(preEl: HTMLPreElement): boolean {
    return preEl.style.fontFamily.includes(GLYPH_FONT_ATLAS.family);
  }

  // Closes the CSS-injection gap: `colorEncoding: "atlas"` used to require a
  // consumer to call `buildGlyphAtlasFontFaceCss`/`buildGlyphAtlasFontPaletteValuesCss`
  // by hand and wire the `<pre>`'s `font-family`/`font-palette` themselves.
  // Called once at construction and again from `setOptions` whenever
  // `colorEncoding`/`atlasPalette` are touched — never on every render, since
  // both only change through those two paths. A "spans" scene (the default)
  // never calls `ensureGlyphAtlasFontFaceStyles` — so it never imports the
  // lazy WOFF2 chunk at all — and never creates `atlasPaletteStyleEl`, so it
  // stays byte-identical and DOM-injection-free.
  function syncGlyphAtlasStyles(): void {
    if (options.colorEncoding === "atlas") {
      // Kick the shared lazy load. The first resolution flips this scene into
      // real atlas encoding and schedules the re-render that replaces its
      // spans-fallback frames; a scene created after the payload is already
      // cached still goes through this promise, so the "first frame is spans"
      // rule holds uniformly instead of depending on load order.
      void ensureGlyphAtlasFontFaceStyles(host.ownerDocument ?? undefined).then((ready) => {
        if (destroyed || !ready || atlasFontReady) return;
        atlasFontReady = true;
        // Nothing wrote palette CSS while the font was missing — no quantizer
        // was allocated (see `activeAtlasPalette`) — so publish it alongside
        // the re-render that will finally encode against it.
        writeGlyphAtlasPaletteCss();
        scheduleRender();
      });
      writeGlyphAtlasPaletteCss();
    } else {
      // Leaving `"atlas"`: unpin every output now. Pinning in the other
      // direction is NOT symmetric — it happens per output at commit, once a
      // frame has actually been atlas-encoded (see `setGlyphAtlasFontOn`).
      // This unpin runs SYNCHRONOUSLY, ahead of the render this same
      // `setOptions` call schedules — so by the time that render's
      // `commitRender` asks "was this output pinned before this commit?" the
      // answer is already `false` and no flip is ever observed there. The
      // invalidation a flip would have triggered has to happen HERE instead,
      // alongside the eager unpin, not deferred to a `commitRender` that will
      // never see one.
      const baseWasPinned = isGlyphAtlasPinned(pre);
      setGlyphAtlasFontOn(pre, false);
      if (baseWasPinned) {
        baseCellCache = null;
        if (options.autoSize) fitToHost();
      }
      for (const layer of detailLayers.values()) {
        const layerWasPinned = isGlyphAtlasPinned(layer.pre);
        setGlyphAtlasFontOn(layer.pre, false);
        if (layerWasPinned) layer.key = "";
      }
    }
  }

  // The `@font-palette-values` half of the wiring, split out so the async
  // font-ready callback above can refresh it without re-entering the loader.
  function writeGlyphAtlasPaletteCss(): void {
    // The pooled quantizer's palette when the caller didn't pin one — the
    // block must always declare the palette the `<pre>` was actually
    // ENCODED against, since a slot is meaningless without it.
    const palette = options.atlasPalette ?? atlasQuantizer?.palette;
    if (!palette || palette.length === 0) return;
    // Stable for the scene's lifetime once allocated (see the field doc)
    // — only the block's CONTENT is refreshed on a later palette edit.
    if (!atlasPaletteName) atlasPaletteName = `--glyph-atlas-palette-${nextAtlasStyleId++}`;
    if (!atlasPaletteStyleEl) {
      atlasPaletteStyleEl = host.ownerDocument!.createElement("style");
      host.ownerDocument!.head.appendChild(atlasPaletteStyleEl);
    }
    atlasPaletteStyleEl.textContent = buildGlyphAtlasFontPaletteValuesCss(atlasPaletteName, palette);
    atlasPaletteCssGeneration = atlasQuantizer?.generation ?? -1;
    // Only the `font-palette` half here — an output that is not currently
    // painting atlas text must not acquire the family as a side effect of a
    // palette refresh.
    if (isGlyphAtlasPinned(pre)) pre.style.setProperty("font-palette", atlasPaletteName);
    for (const layer of detailLayers.values()) {
      if (isGlyphAtlasPinned(layer.pre)) layer.pre.style.setProperty("font-palette", atlasPaletteName);
    }
  }

  /**
   * Publish a repooled palette to CSS. The `<pre>`s of this frame were already
   * encoded against it — the quantizer decides a repool DURING rasterization,
   * before any encoding — so this only catches the stylesheet up, and it runs
   * after a successful commit so a rolled-back render can't leave the CSS
   * describing a palette no `<pre>` uses. A repool is gated to at most one per
   * `refreshMs` (default 250 ms), so this is a `<style>` textContent write a
   * few times a second at most, never per frame, and never a `<pre>` write —
   * the one-write-per-`<pre>`-per-cycle invariant is untouched.
   */
  function syncGlyphAtlasPaletteCss(): void {
    if (options.colorEncoding !== "atlas" || options.atlasPalette) return;
    if (!atlasQuantizer || atlasQuantizer.generation === atlasPaletteCssGeneration) return;
    writeGlyphAtlasPaletteCss();
  }

  function commitRender(plan: RenderCommit): void {
    testRenderStage("commit-write");
    const basePinnedBefore = isGlyphAtlasPinned(pre);
    // Pin state of every node THIS commit is about to (re)write, captured
    // before `setGlyphAtlasFontOn` runs below — the per-node counterpart to
    // `basePinnedBefore`, needed because a detail layer's own pin can flip
    // independently of the base's (a mesh-targeted effect or a raw color can
    // make just that one grid unencodable while the base stays atlas).
    const writesPinnedBefore = new Map<HTMLPreElement, boolean>();
    for (const entry of plan.writes) writesPinnedBefore.set(entry.pre, isGlyphAtlasPinned(entry.pre));
    const outputNodes = new Set<HTMLPreElement>([pre, ...Array.from(detailLayers.values(), (layer) => layer.pre), ...plan.writes.map((entry) => entry.pre)]);
    const outputs = Array.from(outputNodes, (node) => ({ node, html: node.innerHTML, text: node.textContent ?? "", style: node.getAttribute("style") }));
    const oldDetails = new Map(detailLayers);
    const oldRetained = retainedEffectOutputs;
    const oldHotspots = plan.hotspots.map(({ el }) => ({ el, style: el.getAttribute("style") }));
    try {
      for (const entry of plan.writes) {
        if (options.useColors) entry.pre.innerHTML = entry.encoded;
        else entry.pre.textContent = entry.encoded;
        // Same transaction as the text it describes: a node never carries the
        // atlas font stack while holding span-encoded text, or vice versa.
        // Rolled back with the rest by the style-attribute restore below.
        setGlyphAtlasFontOn(entry.pre, entry.atlas);
      }
      testRenderStage("commit-style");
      for (const [, layer] of plan.details.next) {
        layer.pre.style.fontSize = layer.fontSize;
        layer.pre.style.lineHeight = layer.lineHeight;
        layer.pre.style.transform = layer.transform;
      }
      for (const style of plan.hotspots) {
        style.el.style.display = style.display;
        if (style.left !== undefined) style.el.style.left = style.left;
        if (style.top !== undefined) style.el.style.top = style.top;
        if (style.zIndex !== undefined) style.el.style.zIndex = style.zIndex;
      }
      // Every fallible stage is complete before the live child list changes.
      // In particular, a failed transaction must not create observer-visible
      // remove/reinsert records for detail layers.
      testRenderStage("commit-insert");
      testRenderStage("commit-remove");
      const fragment = host.ownerDocument!.createDocumentFragment();
      for (const [id, layer] of plan.details.next) {
        if (!detailLayers.has(id)) fragment.appendChild(layer.pre);
      }
      // Native fragment insertion into this owned div is the terminal commit
      // operation: no user code, stage hook, or renderer work follows it.
      for (const layer of plan.details.removed) {
        if (layer.pre.parentNode === sceneEl) sceneEl.removeChild(layer.pre);
      }
      if (fragment.firstChild) sceneEl.insertBefore(fragment, hotspotLayer);
      detailLayers.clear();
      for (const [id, layer] of plan.details.next) detailLayers.set(id, layer);
      if (plan.retained) retainedEffectOutputs = plan.retained;
    } catch (error) {
      for (const state of outputs) {
        try {
          if (committedOptions.useColors) state.node.innerHTML = state.html;
          else state.node.textContent = state.text;
        } catch { /* preserve rollback progress */ }
        if (state.style === null) state.node.removeAttribute("style"); else state.node.setAttribute("style", state.style);
      }
      for (const state of oldHotspots) {
        if (state.style === null) state.el.removeAttribute("style"); else state.el.setAttribute("style", state.style);
      }
      detailLayers.clear();
      for (const [id, layer] of oldDetails) detailLayers.set(id, layer);
      retainedEffectOutputs = oldRetained;
      throw error;
    }
    syncGlyphAtlasPaletteCss();
    // The base grid just changed which font it paints in (the atlas arriving,
    // or a frame falling back to spans). Its cell advance changed with it, so
    // the cached measurement — which `autoSize` fit, hotspot placement and
    // every detail-layer transform are derived from — is stale. This settles
    // in one extra render: the re-render re-measures in the new font and the
    // pinning does not flip again unless the encoding does.
    let needsSettlingRender = false;
    if (isGlyphAtlasPinned(pre) !== basePinnedBefore) {
      baseCellCache = null;
      if (options.autoSize) fitToHost();
      needsSettlingRender = true;
    }
    // Same settling logic per detail layer: `plan.writes` carries what the
    // encoder actually PRODUCED for every output node this cycle, base and
    // detail alike, so a detail layer's own pin can flip on its own (its
    // grid stopped/started being atlas-encodable while the base's didn't).
    // Without this, that layer's cached cell metrics stay keyed to the font
    // it was measured in before the flip and nothing ever re-measures it —
    // the density path derives them straight from the base's cell, and the
    // explicit fontSize/lineHeight path measures its own but never gets a
    // render to do it in.
    for (const entry of plan.writes) {
      if (entry.pre === pre) continue;
      if (writesPinnedBefore.get(entry.pre) === entry.atlas) continue;
      for (const layer of detailLayers.values()) {
        if (layer.pre === entry.pre) { layer.key = ""; break; }
      }
      needsSettlingRender = true;
    }
    if (needsSettlingRender) scheduleRender();
  }

  /**
   * Render each detail mesh into its own absolutely-positioned <pre>, sized to
   * the mesh silhouette and translated to its on-screen position. The projection
   * keeps the base camera zoom/fov and swaps in the detail grid's measured cell
   * size, so the mesh occupies the same CSS-pixel footprint as the shared grid
   * with more glyph cells inside it.
   */
  function renderDetailLayers(
    entries: MeshEntry[],
    occShared: { idMap: Int32Array; cols: number; rows: number; ss: number; cwB: number; chB: number } | null,
    baseGrid: GridSize,
    retainBaseShade: boolean,
    retainWorldPosition: boolean,
    retainNormal: boolean,
    retainObjectPosition: boolean,
    retainObjectExit: boolean,
    retainObjectNormal: boolean,
    retainWinnerMesh: boolean,
    worldToSceneScale: number | undefined,
    semanticLineage: readonly GlyphControlPolygonLineage[] | null,
    globalPolygonOffsets: ReadonlyMap<number, number>,
    transformedByEntry: ReadonlyMap<number, Polygon[]>,
  ): void {
    const effectsActive = activePreparedEffects !== null;
    const nextLayers = new Map<number, DetailLayerState>();
    const removed = Array.from(detailLayers.entries())
      .filter(([id]) => !entries.some((entry) => entry.id === id))
      .map(([, layer]) => layer);

    const camera = options.camera;
    const baseZoom = camera.zoom;
    const baseFovScale = camera.fovScale;
    const originalCenter = camera.center;
    const baseCenter: [number, number] = [originalCenter[0], originalCenter[1]];
    const colsB = options.cols, rowsB = options.rows, caB = options.cellAspect;
    const baseCell = baseCellMetrics();
    const cwB = baseGrid.cellWidth ?? baseCell.w, chB = baseGrid.cellHeight ?? baseCell.h;
    if (!(cwB > 0) || !(chB > 0)) {
      stagedDetailCommit = { next: new Map(detailLayers), removed: [] };
      return; // not laid out yet (SSR / detached)
    }
    const baseCenterCol = baseGrid.centerCol ?? colsB * baseCenter[0];
    const baseCenterRow = baseGrid.centerRow ?? rowsB * baseCenter[1];

    try {
      for (const entry of entries) {
        const current = detailLayers.get(entry.id);
        let layer: DetailLayerState;
        if (current) {
          layer = { ...current };
        } else {
          testRenderStage("detail-element");
          const el = host.ownerDocument!.createElement("pre") as HTMLPreElement;
          el.className = "glyph-output glyph-output--detail";
          el.style.cssText =
            "position:absolute;top:0;left:0;margin:0;transform-origin:top left;pointer-events:none";
          // Mirror the base grid's current pinning so this layer's very first
          // cell measurement happens in the font it will most likely paint in;
          // its own first commit corrects it if this mesh turns out to encode
          // differently from the base.
          setGlyphAtlasFontOn(el, isGlyphAtlasPinned(pre));
          layer = { pre: el, key: "", cw: 0, ch: 0, fontSize: "", lineHeight: "", transform: "" };
        }
        const dpre = layer.pre;
        testRenderStage("detail-measure");
        const density = entry.transform.density;
        // Explicit fontSize/lineHeight OVERRIDE density (the low-level escape hatch
        // wins); density is the default convenience knob.
        const hasExplicit = entry.transform.fontSize != null || entry.transform.lineHeight != null;
        if (!hasExplicit && density != null && density > 0) {
          // density path: cell = base cell ÷ density, derived exactly from the base
          // font (no per-frame layout measurement). fontSize scales linearly, so
          // setting the <pre> font to base/density yields exactly base cell/density
          // — but ONLY while this layer paints in the SAME font as the base right
          // now: the linear scaling is a property of ONE face, and stops holding
          // the moment this layer's own pin diverges from the base's (this mesh's
          // grid fell back to spans while the base stayed atlas, or vice versa —
          // a mesh-targeted effect or a raw, non-#rrggbb color can do this to just
          // one grid). The base cell is part of the key: a density layer derives
          // its own cell from it, so a base-cell change (a fit, an option change,
          // or the atlas font arriving and changing the measured advance) has to
          // re-derive it instead of holding a stale multiple of the old one.
          // Whether THIS layer currently shares the base's pin also joins the
          // key, so a layer whose own encoding diverges — or re-converges —
          // re-derives instead of keeping a metric taken under the other
          // assumption.
          const sameFontAsBase = isGlyphAtlasPinned(dpre) === isGlyphAtlasPinned(pre);
          const key = `d:${density}:${cwB}:${chB}:${sameFontAsBase ? "same" : dpre.style.fontFamily}`;
          if (layer.key !== key) {
            const fontSizePx = baseFontPx() / density;
            layer.fontSize = `${fontSizePx}px`;
            layer.lineHeight = "";
            if (sameFontAsBase) {
              layer.cw = cwB / density; layer.ch = chB / density;
            } else {
              // Divergent font: the base cell's advance doesn't transfer, so
              // measure this layer's own painted font stack directly instead
              // of scaling a measurement taken in a different face.
              const m = measureDetailCell(layer.fontSize, "", dpre.style.fontFamily);
              layer.cw = m.w; layer.ch = m.h;
            }
            layer.key = key;
          }
        } else {
          // legacy escape hatch: explicit fontSize / lineHeight (CSS-measured).
          const fs = entry.transform.fontSize;
          const fsStr = fs == null ? "" : typeof fs === "number" ? `${fs}px` : fs;
          const lhStr = entry.transform.lineHeight == null ? "" : String(entry.transform.lineHeight);
          // The font stack joins the key for the same reason the base cell
          // joins the density key above: the measured advance depends on it.
          const key = `${fsStr}|${lhStr}|${dpre.style.fontFamily}`;
          if (layer.key !== key) {
            layer.fontSize = fsStr;
            layer.lineHeight = lhStr;
            // Keep CSS as CSS: this handles px/em/rem/calc/var/normal and
            // inherited declarations with the browser's own layout engine.
            const m = measureDetailCell(fsStr, lhStr, dpre.style.fontFamily);
            layer.key = key; layer.cw = m.w; layer.ch = m.h;
          }
        }
        let cwD = layer.cw, chD = layer.ch;
        if (!(cwD > 0) || !(chD > 0)) { nextLayers.set(entry.id, layer); continue; }

        // Render the mesh IN PLACE (no centering) into a bbox-fitted sub-window.
        // Works for ANY camera (ortho / perspective / FPV): real world positions
        // are kept so foreshortening stays correct. The finer resolution comes from
        // the detail grid's measured cell size; zoom and fovScale stay the same as
        // the base layer so depth and apparent size cannot drift.
        const tp = transformedByEntry.get(entry.id) ?? applyTransform(entry.polygons, entry.transform);

        // Mesh screen bbox in BASE cells (base zoom + center + fovScale).
        camera.zoom = baseZoom; camera.center = originalCenter; camera.fovScale = baseFovScale;
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const p of tp) for (const v of p.vertices) {
          testRenderStage("detail-project");
          const pr = camera.project(v, colsB, rowsB, caB, baseGrid);
          if (!isFinite(pr[0]) || !isFinite(pr[1])) continue;
          if (pr[0] < minC) minC = pr[0]; if (pr[0] > maxC) maxC = pr[0];
          if (pr[1] < minR) minR = pr[1]; if (pr[1] > maxR) maxR = pr[1];
        }
        if (!(maxC > minC) || !(maxR > minR)) { writeOrStageFullOutput(dpre, ""); nextLayers.set(entry.id, layer); continue; } // off-screen / clipped

        // Clamp the bbox to the visible grid (+margin), THEN size the detail grid.
        // A mesh near or enclosing the camera projects some verts to huge coords
        // (perspective near-plane blowup); without this the detail grid would
        // explode to millions of cells. Only the on-screen slice is rendered.
        const PADB = 1; // base-cell margin around the silhouette
        minC = Math.max(-PADB, minC - PADB); maxC = Math.min(colsB + PADB, maxC + PADB);
        minR = Math.max(-PADB, minR - PADB); maxR = Math.min(rowsB + PADB, maxR + PADB);
        if (!(maxC > minC) || !(maxR > minR)) { writeOrStageFullOutput(dpre, ""); nextLayers.set(entry.id, layer); continue; } // fully off-screen
        let kx = cwB / cwD, ky = chB / chD; // detail cells per base cell (= density)
        // Cap the detail grid: the viewport clamp bounds the bbox in BASE cells, but the
        // grid is bbox×density, so an absurd density (or tiny fontSize) still explodes it.
        // Coarsen the detail cell to fit MAX_DIM — graceful: beyond this, density just
        // stops getting finer. Reset the <pre> font to match the capped cell.
        const MAX_DIM = 1024;
        const need = Math.max((maxC - minC) * kx, (maxR - minR) * ky);
        if (need > MAX_DIM) {
          const f = MAX_DIM / need; // < 1: scale resolution down to fit
          cwD /= f; chD /= f; kx = cwB / cwD; ky = chB / chD;
          layer.fontSize = `${baseFontPx() * (cwD / cwB)}px`;
          layer.lineHeight = ""; layer.key = ""; // capped cell ≠ cached key
        }
        const caD = chD / cwD;
        const colsD = Math.max(2, Math.ceil((maxC - minC) * kx));
        const rowsD = Math.max(2, Math.ceil((maxR - minR) * ky));
        // Offset the projection center so detail cell 0 ↔ base cell minC/minR.
        const centerColD = kx * (baseCenterCol - minC);
        const centerRowD = ky * (baseCenterRow - minR);
        const cxNd = centerColD / colsD;
        const cyNd = centerRowD / rowsD;

        // Opaque detail layers occlude against the shared id-map (owner === this
        // mesh's id → keep, so it never self-occludes); transparent ones don't.
        // Detail cell c maps to base ref cell minC + (c+0.5)/kx.
        // Detail cell c center → base-output ref (minC + (c+0.5)/kx), then × ss to
        // index the supersampled id-map (detail layers render at ss=1, so invSS=1).
        const oss = occShared ? occShared.ss : 1;
        const occ = (occShared && entry.transform.transparent !== true)
          ? {
              idMap: occShared.idMap, layerId: entry.id, cols: occShared.cols, rows: occShared.rows,
              colScale: oss / kx, colOffset: oss * (minC + 0.5 / kx),
              rowScale: oss / ky, rowOffset: oss * (minR + 0.5 / ky),
            }
          : null;

        const detailGrid: GridSize = {
          cols: colsD,
          rows: rowsD,
          cellAspect: caD,
          cellWidth: cwD,
          cellHeight: chD,
          centerCol: centerColD,
          centerRow: centerRowD,
        };

        camera.zoom = baseZoom; camera.fovScale = baseFovScale; camera.center = [cxNd, cyNd];
        const ctx = buildRasterizeContext({
          camera,
          grid: detailGrid,
          polygons: tp,
          mode: options.mode,
          directionalLight: options.directionalLight,
          ambientLight: options.ambientLight,
          glyphPalette: options.glyphPalette,
          charMode: options.charMode,
          wireframeJunctions: options.wireframeJunctions,
          hiddenLines: options.hiddenLines,
          solidWeightRamp: options.solidWeightRamp,
          colorTolerance: options.colorTolerance,
          colorEncoding: effectiveColorEncoding(),
          atlasPalette: activeAtlasPalette(),
          useColors: options.useColors,
          smoothShading: options.smoothShading,
          creaseAngle: options.creaseAngle,
          doubleSided: options.doubleSided,
          // Detail layers render at SS=1 even when the scene supersamples: they're
          // already high-res (their whole point), so coverage AA buys little — and a
          // supersampled detail layer's downsampled silhouette would desync from the
          // output-resolution occlusion id-map (which is NOT supersampled), holing the
          // world at full-cell granularity while the detail only faded-fills it. The
          // base/shared layer keeps the scene's supersample.
          supersample: 1,
          depthEpsilon: options.depthEpsilon,
          temporalBlend: 0,
          shadow: undefined,
          retainShade: retainBaseShade,
          retainWorldPosition,
          retainNormal,
          retainObjectPosition,
          retainObjectNormal,
          // A detail layer's `tp` is always a single mesh's own polygons, but
          // the winner-mesh buffer's uninitialized/occlusion-blanked cells
          // ALSO default to `-1` — the same value every polygon here would
          // carry if `polygonMeshIds` were omitted (see `RasterizeContext.polygonMeshIds`'s
          // "no mesh ids supplied" fallback in rasterize.ts). That collision let
          // a back-facing-only polygon's exit sweep leak into cells with no
          // entry-pass winner at all. Supplying this mesh's own real (>=1) id
          // for every polygon keeps the winner-mesh sentinel unambiguous.
          // Same OR-gate as the base layer above: `retainWinnerMesh` needs
          // this mesh's own id supplied even when no `objectExit` effect is
          // mounted, so a mesh-targeted layer's `targetCoverage` can match
          // this detail grid's own real per-cell winner (VOLUMETRIC-3.md §1
          // — "detail grids already carry a real mesh id").
          polygonMeshIds: (retainObjectExit || retainWinnerMesh) ? tp.map(() => entry.id) : undefined,
          retainObjectExit,
          retainWinnerMesh,
          retainWinnerPolygon: options.glyphOutput === "semantic",
        });
        ctx.textureSamplers = textureSamplers;
        ctx.occlusion = occ;
        currentEffectOutputMetadata = effectsActive ? {
          id: `detail:${entry.id}`,
          pre: dpre,
          isBase: false,
          cellToSceneGrid: [1 / kx, 0, 0, 1 / ky, minC, minR],
          sceneGridSize: [options.cols, options.rows],
          localCellFootprint: [1 / kx, 1 / ky],
          ...(worldToSceneScale !== undefined ? { worldToSceneScale } : {}),
        } : null;
        ctx.transformCells = options.glyphOutput === "visible"
          ? (effectsActive ? transformEffectCells : options.transformCells)
          : undefined;
        testRenderStage("detail-raster");
        const out = options.glyphOutput === "semantic"
          ? (testRenderStage("detail-encode"), encodeSemanticCells(
              rasterizeToCells(ctx),
              semanticLineage!,
              tp.map((_, index) => globalPolygonOffsets.get(entry.id)! + index),
              options.useColors,
            ))
          : (testRenderStage("detail-encode"), rasterize(ctx));
        writeOrStageFullOutput(dpre, out, ctx.atlasEncoded);
        noteAtlasGlyphFallback(ctx.colorEncoding, ctx.atlasGlyphFallback);
        // Detail cell (0,0) maps to base cell (minC,minR) → place the <pre> there.
        testRenderStage("detail-transform");
        layer.transform = `translate(${(minC * cwB).toFixed(2)}px, ${(minR * chB).toFixed(2)}px)`;
        nextLayers.set(entry.id, layer);
      }
      stagedDetailCommit = { next: nextLayers, removed };
    } finally {
      camera.zoom = baseZoom;
      camera.center = originalCenter;
      camera.fovScale = baseFovScale;
    }
  }

  function stageHotspots(): StagedHotspotStyle[] {
    testRenderStage("hotspot-project");
    const { cols, rows, cellAspect, camera } = options;
    const grid = baseProjectionGrid();
    const cells = projectHotspots(
      hotspots.map((h) => h.hotspot),
      camera,
      cols,
      rows,
      cellAspect,
      grid,
    );

    const cellW = grid.cellWidth ?? 8;
    const cellH = grid.cellHeight ?? 16;

    const staged: StagedHotspotStyle[] = [];
    for (let i = 0; i < hotspots.length; i++) {
      const { el } = hotspots[i]!;
      const cell = cells[i]!;
      if (!cell.visible) {
        staged.push({ el, display: "none" });
      } else {
        testRenderStage("hotspot-style");
        // Anchor at the CELL CENTER (not top-left). The `.glyph-hotspot` CSS
        // rule applies `transform: translate(-50%, -50%)` so the visible
        // label/dot is centered on this point — and the rendered ASCII glyph
        // at this cell is also drawn at the cell center, so the two visually
        // coincide.
        staged.push({ el, display: "", left: `${(cell.col + 0.5) * cellW}px`, top: `${(cell.row + 0.5) * cellH}px`, zIndex: String(Math.round(cell.depth * 1000)) });
      }
    }
    return staged;
  }

  function add(polygons: Polygon[], transform: GlyphMeshTransform = {}): GlyphMeshHandle {
    const id = nextMeshId++;
    meshes.set(id, { id, polygons, transform });
    invalidateShading();
    refreshTextureSamplers();
    scheduleRender();

    return {
      get id() { return id; },
      get name() { return meshes.get(id)?.transform.id; },
      get polygons() { return meshes.get(id)?.polygons ?? polygons; },
      setPolygons(next: Polygon[]): void {
        const entry = meshes.get(id);
        if (entry) {
          entry.polygons = next;
          invalidateShading();
          refreshTextureSamplers();
          scheduleRender();
        }
      },
      setTransform(next: GlyphMeshTransform): void {
        const entry = meshes.get(id);
        if (entry) { entry.transform = next; invalidateShading(); scheduleRender(); }
      },
      dispose(): void {
        meshes.delete(id);
        invalidateShading();
        refreshTextureSamplers();
        scheduleRender();
      },
    };
  }

  function addEffectLayer<Schema extends GlyphEffectParamSchema, State = undefined>(
    effectOptions: GlyphEffectDefinitionLayerOptions<Schema, State>,
  ): GlyphEffectLayerHandle<GlyphEffectParamValues<Schema>>;
  function addEffectLayer<P extends GlyphEffectParamShape<P>, State = undefined>(
    effectOptions: GlyphEffectProgramLayerOptions<P, State>,
  ): GlyphEffectLayerHandle<P>;
  function addEffectLayer(
    effectOptions: GlyphEffectDefinitionLayerOptions<any, any> | GlyphEffectProgramLayerOptions<any, any>,
  ): GlyphEffectLayerHandle<any> {
    if (destroyed) throw new Error("glyphcss: cannot add an effect layer to a destroyed scene.");
    const layer = createRuntimeGlyphEffectLayer(
      effectOptions,
      nextEffectDeclarationOrder++,
      // A plain params change only needs a cheap retained-effect recompose;
      // a `dynamicRequirements`-changing one (e.g. field-synth's `render`
      // flipping to `"carve"`) additionally invalidates whatever retained
      // input buffers the previous requirement set produced — only a full
      // geometry render (which recomputes `effectRequests`/`retainObjectExit`
      // and reruns the exit sweep) repopulates those.
      (requirementsChanged) => {
        if (requirementsChanged) scheduleRender();
        else scheduleEffectRender();
      },
      (disposedLayer) => {
        const index = effectLayers.indexOf(disposedLayer);
        if (index >= 0) effectLayers.splice(index, 1);
        scheduleEffectRender();
      },
    );
    assertEffectMode(options.mode, [layer]);
    effectLayers.push(layer);
    const requested = new Set([
      ...(layer.program.requirements ?? []),
      ...(layer.program.optionalRequirements ?? []),
      ...(layer.program.dynamicRequirements?.(layer.paramsTarget) ?? []),
    ]);
    const needsInputRaster = Array.from(retainedEffectOutputs.values()).some((output) => (
      (requested.has("baseShade") && !output.base.shade)
      || (requested.has("worldPosition") && !output.base.worldPosition)
      || (requested.has("normal") && !output.base.normal)
      || (requested.has("objectPosition") && !output.base.objectPosition)
      || (requested.has("objectExit") && !output.base.objectExit)
      || (requested.has("objectNormal") && !output.base.objectNormal)
      // A newly-mounted mesh-targeted layer (VOLUMETRIC-3.md §1) needs a
      // full geometry render when retained frames predate it and so lack
      // winner-mesh data — otherwise it silently no-ops (targetCoverage
      // reads a missing winnerMesh as "no winner", so nothing composites)
      // until the next geometry render. Checks the retained `CellGrid`
      // directly rather than `output.base.winnerMesh` — equivalent (both
      // mirror the same buffer as of Phase 2), but this is the one already
      // guaranteed to exist regardless of whether `base` was built yet.
      || (layer.target instanceof Set && !output.baseGrid.winnerMesh)
    ));
    if (needsInputRaster) scheduleRender();
    else if (retainedEffectOutputs.size > 0) scheduleEffectRender();
    else scheduleRender();
    return layer.handle;
  }

  function addHotspot(hotspotOpts: GlyphHotspotOptions, onClick?: () => void): GlyphHotspotHandle {
    const el = host.ownerDocument!.createElement("div");
    el.className = "glyph-hotspot";
    el.setAttribute("data-hotspot-id", hotspotOpts.id);
    const [w, h] = hotspotOpts.size ?? [1, 1];
    el.style.position = "absolute";
    el.style.width = `${w}ch`;
    el.style.height = `${h * options.cellAspect}ch`;
    if (onClick) el.addEventListener("click", onClick);
    hotspotLayer.appendChild(el);

    const entry = {
      hotspot: { id: hotspotOpts.id, at: hotspotOpts.at, size: hotspotOpts.size },
      el,
      onClick,
    };
    hotspots.push(entry);
    scheduleRender();

    return {
      get el() { return el; },
      remove(): void {
        const idx = hotspots.indexOf(entry);
        if (idx >= 0) hotspots.splice(idx, 1);
        if (onClick) el.removeEventListener("click", onClick);
        hotspotLayer.removeChild(el);
        scheduleRender();
      },
    };
  }

  function rerender(): void {
    // A direct rerender supersedes a queued microtask. Without this, a caller
    // that handles a synchronous render failure can observe an unrelated second
    // render after removing its failure hook.
    renderGeneration += 1;
    pendingRender = false;
    doRender();
  }

  // Interactive level-of-detail: while dragging, render coarser (bigger cell →
  // fewer cells at the SAME on-screen size, since camera.zoom is unchanged), then
  // restore full detail on release. Only the font/cols swap happens per gesture
  // (twice), not per frame — every drag frame in between is cheap.
  let interacting = false;
  let savedInteractFont: string | null = null;
  let savedInteractCols = 0, savedInteractRows = 0;
  function setInteracting(active: boolean): void {
    const ds = options.interactiveDownscale ?? 1;
    if (ds <= 1 || active === interacting) return;
    interacting = active;
    if (active) {
      savedInteractFont = pre.style.fontSize;
      pre.style.fontSize = `${baseFontPx() * ds}px`;
      if (options.autoSize) {
        fitToHost(); // re-measures the coarser cell → cols/rows ÷ ds
      } else {
        savedInteractCols = options.cols; savedInteractRows = options.rows;
        options.cols = Math.max(2, Math.round(options.cols / ds));
        options.rows = Math.max(2, Math.round(options.rows / ds));
        baseCellCache = null; baseFontPxCache = null;
      }
    } else {
      pre.style.fontSize = savedInteractFont ?? "";
      if (options.autoSize) {
        fitToHost();
      } else {
        options.cols = savedInteractCols; options.rows = savedInteractRows;
        baseCellCache = null; baseFontPxCache = null;
      }
      savedInteractFont = null;
    }
    rerender();
  }

  function setOptions(partial: Partial<GlyphSceneOptions>): void {
    const nextGlyphOutput = "glyphOutput" in partial ? (partial.glyphOutput ?? "visible") : options.glyphOutput;
    const nextMode = partial.mode ?? options.mode;
    const nextSceneManifest = "sceneManifest" in partial ? partial.sceneManifest : options.sceneManifest;
    const nextDictionary = "dictionary" in partial ? partial.dictionary : options.dictionary;
    if (nextGlyphOutput !== "visible" && nextGlyphOutput !== "semantic") {
      throw new TypeError('glyphcss: glyphOutput must be "visible" or "semantic".');
    }
    if (nextGlyphOutput === "semantic") {
      if (nextMode !== "solid") throw new RangeError("glyphcss: semantic glyph output requires solid mode.");
      if (!nextSceneManifest || !nextDictionary) {
        throw new TypeError("glyphcss: semantic glyph output requires sceneManifest and dictionary.");
      }
      validateGlyphControlMetadata(nextSceneManifest, nextDictionary);
      const polygons: Polygon[] = [];
      for (const entry of meshes.values()) polygons.push(...applyTransform(entry.polygons, entry.transform));
      if (polygons.length > 0) resolveGlyphControlLineage(polygons, nextSceneManifest, nextDictionary);
    }
    if (partial.mode !== undefined) assertEffectMode(partial.mode);
    if (partial.mode !== undefined) options.mode = partial.mode;
    if (partial.glyphPalette !== undefined) options.glyphPalette = partial.glyphPalette;
    if (partial.charMode !== undefined) options.charMode = partial.charMode;
    if (partial.wireframeJunctions !== undefined) options.wireframeJunctions = partial.wireframeJunctions;
    if (partial.hiddenLines !== undefined) options.hiddenLines = partial.hiddenLines;
    // Unlike `charMode`/`hiddenLines` (which always have a meaningful
    // non-undefined default), `solidWeightRamp`'s "off" state IS `undefined` —
    // so clearing it needs the same explicit "key present" check `shadow`/
    // `sceneManifest`/`dictionary` use below, not a `!== undefined` guard.
    if ("solidWeightRamp" in partial) options.solidWeightRamp = partial.solidWeightRamp;
    if (partial.colorTolerance !== undefined) options.colorTolerance = normalizeGlyphColorTolerance(partial.colorTolerance);
    if (partial.colorEncoding !== undefined) options.colorEncoding = normalizeGlyphColorEncoding(partial.colorEncoding);
    // Unlike `colorTolerance` (whose "off" state is the numeric default `0`),
    // `atlasPalette`'s "off" state IS `undefined` — same explicit
    // "key present" check `solidWeightRamp` uses above, so clearing the
    // palette (falling back to spans) is reachable through `setOptions`.
    if ("atlasPalette" in partial) options.atlasPalette = partial.atlasPalette;
    if (partial.colorEncoding !== undefined || "atlasPalette" in partial) syncGlyphAtlasStyles();
    // Clear the out-of-atlas-glyph sticky latch on a configuration change that
    // could plausibly change which glyphs get drawn — see
    // `atlasGlyphFallbackSticky`'s own doc for why `atlasFontReady`'s
    // "font not ready" reason must NOT go through this same reset path.
    if (
      partial.colorEncoding !== undefined || "atlasPalette" in partial ||
      partial.mode !== undefined || partial.charMode !== undefined
    ) {
      atlasGlyphFallbackSticky = false;
    }
    if (partial.useColors !== undefined) options.useColors = partial.useColors;
    if (partial.cols !== undefined) options.cols = partial.cols;
    if (partial.rows !== undefined) options.rows = partial.rows;
    if (partial.cellAspect !== undefined) options.cellAspect = partial.cellAspect;
    if (partial.directionalLight !== undefined) options.directionalLight = partial.directionalLight;
    if (partial.ambientLight !== undefined) options.ambientLight = partial.ambientLight;
    if (partial.camera !== undefined) options.camera = partial.camera;
    if (partial.smoothShading !== undefined) options.smoothShading = partial.smoothShading;
    if (partial.creaseAngle !== undefined) options.creaseAngle = partial.creaseAngle;
    if (partial.doubleSided !== undefined) options.doubleSided = partial.doubleSided;
    if (partial.supersample !== undefined) options.supersample = partial.supersample;
    if (partial.depthEpsilon !== undefined) options.depthEpsilon = partial.depthEpsilon;
    if (partial.temporalBlend !== undefined) options.temporalBlend = partial.temporalBlend;
    if (partial.interactiveDownscale !== undefined) options.interactiveDownscale = partial.interactiveDownscale;
    if ("glyphOutput" in partial) options.glyphOutput = nextGlyphOutput;
    if ("sceneManifest" in partial) options.sceneManifest = partial.sceneManifest;
    if ("dictionary" in partial) options.dictionary = partial.dictionary;
    if ("shadow" in partial) options.shadow = partial.shadow;
    // Forward on presence (including explicit undefined) so removing the prop
    // clears the hook and restores the byte-identical no-hook path.
    if ("transformCells" in partial) options.transformCells = partial.transformCells;
    if (partial.autoSize !== undefined) {
      options.autoSize = partial.autoSize;
      if (options.autoSize && !resizeObserver && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => fitToHost());
        resizeObserver.observe(host);
        fitToHost();
      } else if (!options.autoSize && resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    }
    // Invalidate the shading cache only when an option that changes per-triangle
    // intensities or lit color is touched. Grid size, camera, autoSize and
    // shadow leave the cached shading valid (shadows blend per cell at fill).
    if (
      partial.mode !== undefined || partial.useColors !== undefined ||
      partial.directionalLight !== undefined || partial.ambientLight !== undefined ||
      partial.smoothShading !== undefined || partial.creaseAngle !== undefined ||
      partial.glyphPalette !== undefined
    ) {
      invalidateShading();
    }
    scheduleRender();
  }

  function getOptions(): GlyphSceneOptions {
    return { ...options };
  }

  /**
   * Measure one monospace character cell from the live `<pre>` element and
   * compute `cols`/`rows` that fill the host's client box. We probe the actual
   * `<pre>` (not the host) so the measurement reflects the inherited font.
   * Falls back to the existing cols/rows when the host has zero size (not yet
   * attached) so the scene still renders.
   */
  function measureCell(): { w: number; h: number } {
    // Inherit line-height + font-size from the `<pre>` so the measurement
    // reflects any caller-applied overrides (e.g. the gallery's lineHeight
    // tunable). Hardcoding `line-height: 1` here would defeat the purpose.
    //
    // Height is measured from a MULTI-LINE probe (height ÷ N), not a single
    // character. A single inline span's bounding box can't shrink below the
    // font's glyph height, so at line-height < ~0.8 it over-reports the cell
    // height — autoSize then computes too few rows and the rendered <pre>
    // (which lays out lines at the true line-height) ends up shorter than the
    // host, visually shrinking the scene. Stacking N lines and dividing
    // recovers the real per-line advance at any line-height.
    const LINES = 20;
    const probe = host.ownerDocument!.createElement("span");
    // Same probe-character rule as `measureCellOf`: this span inherits the
    // `<pre>`'s font stack, and "M" is not in the atlas cmap, so probing with
    // it on an atlas-pinned `<pre>` sizes the grid from the FALLBACK font's
    // advance while the scene paints at the atlas's.
    probe.textContent = Array(LINES).fill(isGlyphAtlasPinned(pre) ? ATLAS_METRIC_PROBE_CHAR : "M").join("\n");
    probe.style.cssText =
      "position:absolute;visibility:hidden;font-family:inherit;font-size:inherit;line-height:inherit;white-space:pre;padding:0;margin:0";
    pre.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { w: r.width || 8, h: r.height ? r.height / LINES : 16 };
  }

  function fitToHost(): void {
    baseCellCache = null; baseFontPxCache = null; // host/cell size may have changed
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const cell = measureCell();
    const cols = Math.max(20, Math.floor(w / cell.w));
    const rows = Math.max(8, Math.floor(h / cell.h));
    const cellAspect = cell.h / cell.w;
    let changed = false;
    if (options.cols !== cols) { options.cols = cols; changed = true; }
    if (options.rows !== rows) { options.rows = rows; changed = true; }
    if (Math.abs(options.cellAspect - cellAspect) > 0.01) { options.cellAspect = cellAspect; changed = true; }
    if (changed) scheduleRender();
  }

  let resizeObserver: ResizeObserver | null = null;
  if (options.autoSize && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => fitToHost());
    resizeObserver.observe(host);
    // Initial fit (also handles the case where the host already has a size).
    fitToHost();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    for (const layer of effectLayers) layer.disposed = true;
    effectLayers.length = 0;
    retainedEffectOutputs.clear();
    meshes.clear();
    detailCellMeasureCache.clear();
    // This scene's own `@font-palette-values` block (never the shared,
    // document-global `@font-face` — that outlives every individual scene).
    if (atlasPaletteStyleEl?.parentNode) atlasPaletteStyleEl.parentNode.removeChild(atlasPaletteStyleEl);
    atlasPaletteStyleEl = null;
    if (host.contains(sceneEl)) host.removeChild(sceneEl);
  }

  syncGlyphAtlasStyles();
  scheduleRender();

  return {
    get host() { return host; },
    get output() { return pre; },
    get camera() { return options.camera; },
    add,
    addEffectLayer,
    addHotspot,
    rerender,
    setOptions,
    getOptions,
    getGlyphSemanticCellFrame: () => semanticCellFrame,
    fit: fitToHost,
    setInteracting,
    destroy,
  };
}
