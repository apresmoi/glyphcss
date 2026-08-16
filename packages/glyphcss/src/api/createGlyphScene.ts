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
import { buildRasterizeContext } from "./rasterizeContext";
import type { ShadeCache, TemporalHistory } from "./rasterizeContext";
import { rasterize, rasterizeToCells, computeOcclusionIds } from "../render/rasterize";
import { encodeCellGrid, encodeGlyphBuffers, type CellGrid, type TransformCells } from "../render/cells";
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
import { injectGlyphBaseStyles } from "../styles/styles";
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
  writes: Array<{ pre: HTMLPreElement; encoded: string }>;
  details: DetailCommit;
  hotspots: StagedHotspotStyle[];
  retained: Map<string, RetainedGlyphEffectOutput> | null;
}

type InternalOptions = Omit<Required<GlyphSceneOptions>, "shadow" | "transformCells" | "sceneManifest" | "dictionary" | "solidWeightRamp"> & {
  shadow: GlyphShadowOptions | undefined;
  transformCells: TransformCells | undefined;
  sceneManifest: GlyphControlSceneManifest | undefined;
  dictionary: GlyphObjectDictionary | undefined;
  solidWeightRamp: GlyphSolidWeightRampStep[] | undefined;
};

let nextMeshId = 1;

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
  let stagedFullEffectWrites: Array<{ pre: HTMLPreElement; encoded: string }> | null = null;
  let stagedDetailCommit: DetailCommit | null = null;
  let semanticCellFrame: GlyphSemanticCellFrame | null = null;

  function hasEffectLayers(): boolean {
    return effectLayers.length > 0;
  }

  function effectRequests(requirement: "baseShade" | "normal" | "worldPosition" | "objectPosition" | "objectExit"): boolean {
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

  function writeOrStageFullOutput(outputPre: HTMLPreElement, encoded: string): void {
    if (!stagedFullEffectWrites) throw new Error("glyphcss: output write escaped its render transaction.");
    stagedFullEffectWrites.push({ pre: outputPre, encoded });
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
    const staged: Array<{ output: RetainedGlyphEffectOutput; encoded: string }> = [];
    for (const output of retainedEffectOutputs.values()) {
      testRenderStage("effect-compose");
      const grid = runLegacyCellHook(composeRetainedGlyphEffectOutput(output, prepared));
      staged.push({ output, encoded: encodeCellGrid(grid, options.useColors) });
    }
    commitRender({
      writes: staged.map(({ output, encoded }) => ({ pre: output.metadata.pre, encoded })),
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

    writeOrStageFullOutput(pre, output);

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
    probe.textContent = Array(LINES).fill("M").join("\n");
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
  function measureDetailCell(fontSize: string, lineHeight: string): { w: number; h: number; measured: boolean } {
    const candidate = host.ownerDocument!.createElement("pre");
    candidate.className = "glyph-output glyph-output--detail";
    candidate.style.cssText = "position:absolute;top:0;left:0;margin:0;transform-origin:top left;pointer-events:none";
    candidate.style.fontSize = fontSize;
    candidate.style.lineHeight = lineHeight;
    return measureCellOf(candidate);
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

  function commitRender(plan: RenderCommit): void {
    testRenderStage("commit-write");
    const outputNodes = new Set<HTMLPreElement>([pre, ...Array.from(detailLayers.values(), (layer) => layer.pre), ...plan.writes.map((entry) => entry.pre)]);
    const outputs = Array.from(outputNodes, (node) => ({ node, html: node.innerHTML, text: node.textContent ?? "", style: node.getAttribute("style") }));
    const oldDetails = new Map(detailLayers);
    const oldRetained = retainedEffectOutputs;
    const oldHotspots = plan.hotspots.map(({ el }) => ({ el, style: el.getAttribute("style") }));
    try {
      for (const entry of plan.writes) {
        if (options.useColors) entry.pre.innerHTML = entry.encoded;
        else entry.pre.textContent = entry.encoded;
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
          // setting the <pre> font to base/density yields exactly base cell/density.
          const key = `d:${density}`;
          if (layer.key !== key) {
            layer.fontSize = `${baseFontPx() / density}px`;
            layer.lineHeight = "";
            layer.key = key; layer.cw = cwB / density; layer.ch = chB / density;
          }
        } else {
          // legacy escape hatch: explicit fontSize / lineHeight (CSS-measured).
          const fs = entry.transform.fontSize;
          const fsStr = fs == null ? "" : typeof fs === "number" ? `${fs}px` : fs;
          const lhStr = entry.transform.lineHeight == null ? "" : String(entry.transform.lineHeight);
          const key = `${fsStr}|${lhStr}`;
          if (layer.key !== key) {
            layer.fontSize = fsStr;
            layer.lineHeight = lhStr;
            // Keep CSS as CSS: this handles px/em/rem/calc/var/normal and
            // inherited declarations with the browser's own layout engine.
            const m = measureDetailCell(fsStr, lhStr);
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
        writeOrStageFullOutput(dpre, out);
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
    probe.textContent = Array(LINES).fill("M").join("\n");
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
    if (host.contains(sceneEl)) host.removeChild(sceneEl);
  }

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
