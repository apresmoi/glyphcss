/**
 * compileScene — render a scene to its `<pre>` text **without a DOM**.
 *
 * `rasterize` is pure (geometry + camera → string), so a scene can be rendered
 * at build time / on the server / in a worker. This reproduces the exact render
 * path of `createGlyphScene` (same defaults, same RasterizeContext) but returns
 * the HTML string instead of mutating a `<pre>`. It is the foundation of the
 * static-compile toolchain (Vite plugin, CLI, SSR).
 *
 * Defaults are identical to `createGlyphScene` so a compiled scene matches the
 * runtime render 1:1.
 */
import type { Hotspot, HotspotCell, Polygon, RenderMode, TextureSampler } from "@glyphcss/core";
import { recenterPolygons } from "@glyphcss/core";
import type { GlyphCamera } from "./createGlyphCamera";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize } from "../render/rasterize";
import { buildCellGrid, cloneCellGrid, encodeGlyphBuffers, type CellGrid, type GlyphColorEncoding } from "../render/cells";
import type { GlyphFontAtlas } from "../render/fontAtlas";
import { buildGlyphControlFrame } from "./controlFrame";
import type { GlyphControlSceneManifest, GlyphObjectDictionary } from "./controlFrame";
import { projectHotspots } from "./projectHotspots";
import { encodeGlyphSceneObjectSamplerKey } from "./createGlyphScene";
import type { GlyphOverlayFrame, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay } from "./sceneObject";
import { createGlyphLabelArbiter } from "../render/overlay/labelArbiter";
import type {
  GlyphDirectionalLight,
  GlyphAmbientLight,
  GlyphShadowOptions,
  GlyphSolidWeightRampStep,
} from "./types";

export interface CompileSceneOptions {
  /** Polygons to render (already loaded — see the Vite plugin / CLI for files). */
  polygons: Polygon[];
  /** Camera. Default: `createGlyphPerspectiveCamera()` (same as createGlyphScene). */
  camera?: GlyphCamera;
  /** Recenter the mesh bbox to the origin before rendering (matches `autoCenter`). Default false. */
  autoCenter?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  glyphPalette?: string;
  /**
   * Character encoding for rasterized output. `"ascii"` (default) is the
   * original ramp/rule-glyph encoding; `"braille"`/`"halfblock"` match the
   * runtime scene option — see {@link RasterizeContextOptions.charMode}.
   */
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  /**
   * Hidden-line removal for the wireframe path (wireframe + `charMode:
   * "braille"`); `"show"` default matches the runtime scene option — see
   * {@link RasterizeContextOptions.hiddenLines}. Exposed here (unlike
   * `wireframeJunctions`, which is runtime-only) because it is a pure
   * function of geometry + camera, exactly like `charMode`, and fixes a
   * genuine occlusion defect a static bake shouldn't reproduce.
   */
  hiddenLines?: "show" | "hide";
  /**
   * Solid-mode-only font-weight density ramp — see
   * {@link RasterizeContextOptions.solidWeightRamp}. A calibrated `(glyph,
   * weight)[]` step list is plain data (produced ahead of time by
   * `@glyphcss/effects`'s `calibrateWeightedGlyphRamp`), so it bakes here
   * exactly like `charMode` — no browser/canvas dependency at compile time.
   */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  /**
   * Row-wise greedy run-extension color merge tolerance — see
   * {@link RasterizeContextOptions.colorTolerance}. A pure function of the
   * final cell grid, exactly like `charMode`, so a static bake gets the same
   * span-reduction lever the runtime scene does. Default `0` = off,
   * byte-identical output. Not applied to `glyphOutput: "semantic"` output
   * (semantic colors are exact class identifiers, not shaded appearance —
   * merging them under a tolerance would corrupt the lineage).
   */
  colorTolerance?: number;
  /**
   * Encode strategy for the compiled `<pre>` text — see
   * {@link RasterizeContextOptions.colorEncoding}. `"spans"` (default) is
   * byte-identical to before this option existed. `compileScene` is DOM-less
   * and does NOT inject the atlas's `@font-face`/`@font-palette-values` CSS —
   * a caller embedding `"atlas"` output must include those itself (see
   * `render/fontAtlas.ts`'s `loadGlyphAtlasFontFaceCss` — the awaited path,
   * since the WOFF2 payload is a lazily imported chunk — and
   * `buildGlyphAtlasFontPaletteValuesCss`), the same way it must already
   * supply `.glyph-output`'s own styling — `compileScene`/`GlyphSceneStatic`
   * inject no CSS at all today.
   */
  colorEncoding?: GlyphColorEncoding;
  /** Palette `colorEncoding: "atlas"` encodes against — see {@link RasterizeContextOptions.atlasPalette}. */
  atlasPalette?: readonly string[];
  /**
   * Font atlas `colorEncoding: "atlas"` encodes against — the universal
   * `GLYPH_FONT_ATLAS` by default, or `GLYPH_FONT_ATLAS_ASCII` for an
   * all-ASCII scene that wants the 68-slot palette axis instead of the
   * 212-glyph one. Pure configuration, exactly like `charMode`, so a build-time
   * bake can target either variant rather than being pinned to the default.
   *
   * The `@font-face` a caller must supply itself (see `colorEncoding` above)
   * is per-variant: pass the SAME atlas to `loadGlyphAtlasFontFaceCss` and
   * `buildGlyphAtlasFontPaletteValuesCss` that you pass here, or the embedded
   * output resolves its PUA code points against the wrong glyph modulus.
   */
  fontAtlas?: GlyphFontAtlas;
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
  /** Render both sides, but keep Lambert lighting on the authored normal. */
  doubleSided?: boolean;
  supersample?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  shadow?: GlyphShadowOptions;
  /** Select appearance-shaded output (default) or dictionary-semantic solid output. */
  glyphOutput?: "visible" | "semantic";
  /** Immutable polygon lineage required by semantic output. */
  sceneManifest?: GlyphControlSceneManifest;
  /** Immutable class dictionary required by semantic output. */
  dictionary?: GlyphObjectDictionary;
  /**
   * `GlyphSceneObject`s to mount (contract 3, AGENTS.md's "Compilation"
   * section). Every member mesh's polygons join the render; every object's
   * overlays run — in mount order, then declaration order within the
   * object, exactly the order `scene.addObject()` composes them in — against
   * a single shared label arbiter, sharing the occlusion rule ("a label
   * hides iff it's won by a mesh outside its own object"); every hotspot is
   * projected through the same camera; every `textureSamplers` entry merges
   * in under its namespaced key. `compileScene` mounts every object at the
   * IDENTITY transform (no `position`/`rotation`/`scale`) — unlike
   * `scene.addObject(object, transform)`, there is no second transform
   * parameter here, matching how the base `polygons` field already expects
   * final, already-positioned geometry rather than a transform to apply.
   * Overlays are pure functions of `(grid, frame)` (AGENTS.md's own "their
   * overlays are pure and Node-safe" clause), so they run identically here
   * with no browser. Omitted (the default): byte-identical to before this
   * option existed. Not supported with `glyphOutput: "semantic"` — a
   * semantic frame's `sceneManifest`/`dictionary` describe the caller's OWN
   * `polygons` 1:1, and object meshes have no corresponding manifest
   * entries to align with; passing `objects` there throws.
   *
   * A member mesh's own `options` (`GlyphSceneObjectMesh.options`) applies
   * exactly as far as a FLAT static compile can represent it: `castShadow`/
   * `receiveShadow`/`depthBias` reach the rasterizer per-polygon (a real,
   * new capability — object shadow casting/receiving and z-fighting bias now
   * work in `compileScene`, not just at runtime); `occlusionPriority`/
   * `occlusionClaim`/`occlusionContourPx`/`detailGroup` are silently inert —
   * they mean nothing without the cross-layer occlusion id-map a flat
   * compile has no mechanism for, so this is a true no-op, not a dropped
   * effect. A mesh option that pops a mesh into its OWN detail-layer `<pre>`
   * at runtime — `density`, `fontSize`, `lineHeight`, `transparent`,
   * `glyphPalette`, `ambientIntensity`, or a `mode` genuinely different from
   * this call's own — has no flat-compile representation at all (AGENTS.md's
   * "Static compile takes a flat polygon list and cannot represent detail
   * layers"), and `compileScene` REJECTS it with a `RangeError` naming the
   * object, mesh and field rather than silently flattening a mesh that was
   * asking to render at a different density/opacity/mode/palette into the
   * base grid as if it hadn't.
   */
  objects?: GlyphSceneObject[];
  /**
   * Procedural texture samplers, keyed like `scene.setTextureSamplers()`'s
   * own map (contract 3/9). Merges OVER every mounted object's own
   * `textureSamplers` (namespaced via `encodeGlyphSceneObjectSamplerKey`) —
   * this map's own entries win a key collision, exactly the order
   * `resolvedTextureSamplers()` merges them in at runtime.
   * `compileScene` never decodes a texture URL itself (Node-unsafe), so this
   * is the only way a compiled bake gets per-cell texture sampling at all.
   */
  textureSamplers?: ReadonlyMap<string, TextureSampler> | null;
}

export interface CompileSceneResult {
  /** `<pre class="glyph-output">…</pre>` — ready to inline into HTML. */
  html: string;
  /** Just the inner content (colored spans, or escaped text). */
  inner: string;
  cols: number;
  rows: number;
  cellAspect: number;
  /**
   * The final rasterized `CellGrid` the string above was built from
   * (contract 3) — captured from the SAME single rasterize pass that builds
   * `inner` (never a second, independent traversal — a wireframe/voxel
   * mode's own per-cell RANDOM glyph pick would otherwise diverge between
   * two separate walks), so `grid` and `inner` are always the identical
   * render. A durable copy (`buildCellGrid`/`cloneCellGrid`), safe to keep
   * past this call — never the rasterizer's own scratch buffers.
   *
   * `null` under `charMode: "halfblock"` / `"quadrant"` (solid mode only):
   * those encoders paint TWO colours per cell (`▀`/`▄`/`█` etc., fg+bg), and
   * a `CellGrid` has exactly one `color` slot per cell — there is no honest
   * single-`CellGrid` representation of what `inner` actually drew, so this
   * is `null` rather than a silently-wrong single-colour fallback. Every
   * other mode/charMode combination is exactly representable and never
   * returns `null` here.
   */
  grid: CellGrid | null;
  /** Every mounted object's hotspots, projected through this render's own camera/grid — `[]` when no object declares one. */
  hotspots: HotspotCell[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface CompileOverlayEntry {
  readonly overlay: GlyphSceneOverlay;
  readonly ownMeshIds: ReadonlySet<number>;
}

/**
 * A mesh option that pops a mesh into its OWN detail-layer `<pre>` at
 * runtime (AGENTS.md "Per-mesh detail layers") has no flat-compile
 * representation — rejected explicitly (P1-3, F5b fix round 1) rather than
 * silently flattened, which would render such a mesh at the WRONG density/
 * opacity/mode/palette with no signal that anything was dropped. `mode` is
 * the one field that's conditional: declaring the SAME mode this compile is
 * already rendering in keeps the mesh in the shared grid at runtime too
 * (AGENTS.md's own `GlyphMeshTransform.mode` doc), so only a genuinely
 * DIFFERENT mode is rejected here.
 */
function assertCompileMeshOptionsRepresentable(
  objectId: string,
  meshName: string,
  options: GlyphSceneObjectMesh["options"],
  mode: RenderMode,
): void {
  if (!options) return;
  const offending: string | undefined =
    options.density !== undefined ? "density"
    : options.fontSize !== undefined ? "fontSize"
    : options.lineHeight !== undefined ? "lineHeight"
    : options.transparent === true ? "transparent"
    : options.glyphPalette !== undefined ? "glyphPalette"
    : options.ambientIntensity !== undefined ? "ambientIntensity"
    : (options.mode !== undefined && options.mode !== mode) ? "mode"
    : undefined;
  if (offending !== undefined) {
    throw new RangeError(
      `glyphcss: compileScene cannot represent object "${objectId}" mesh "${meshName}"'s "${offending}" option — `
      + 'it separates the mesh into its own runtime detail-layer <pre>, and "static compile takes a flat polygon '
      + 'list and cannot represent detail layers" (AGENTS.md\'s "Per-mesh detail layers"). Drop the option from '
      + "this mesh, or flatten it into ordinary base polygons yourself before calling compileScene.",
    );
  }
}

/**
 * Flattens `objects` into the base polygon list — one unique numeric mesh id
 * per member mesh (0 is reserved for the caller's own non-object
 * `polygons`, so a base-geometry winner is always "foreign" to every
 * object's `ownMeshIds`) — plus the ordered overlay list, flattened
 * hotspots, and every mesh option a FLAT compile can actually represent
 * (`castShadow`/`receiveShadow`/`depthBias`, parallel to the merged polygon
 * list — real capabilities `compileScene` did not have before this fix;
 * `occlusionPriority`/`occlusionClaim`/`occlusionContourPx`/`detailGroup`
 * are silently inert, since they mean nothing without the cross-layer
 * occlusion id-map a flat compile has no mechanism for at all — a true
 * no-op, never a dropped effect). `polygonMeshIds` is only built (and only
 * handed to the rasterizer) when at least one overlay exists, mirroring
 * `createGlyphScene`'s own `retainWinnerMesh` gate — an object with meshes
 * but no overlay never pays for winner-mesh tracking.
 */
function mergeCompileObjects(basePolygons: Polygon[], objects: readonly GlyphSceneObject[] | undefined, mode: RenderMode): {
  polygons: Polygon[];
  polygonMeshIds: number[] | undefined;
  overlayEntries: CompileOverlayEntry[];
  hotspots: Hotspot[];
  textureSamplers: Map<string, TextureSampler> | null;
  depthBiases: number[] | undefined;
  castShadowFlags: boolean[] | undefined;
  receiveShadowFlags: boolean[] | undefined;
} {
  if (!objects || objects.length === 0) {
    return {
      polygons: basePolygons, polygonMeshIds: undefined, overlayEntries: [], hotspots: [], textureSamplers: null,
      depthBiases: undefined, castShadowFlags: undefined, receiveShadowFlags: undefined,
    };
  }
  const polygons = basePolygons.slice();
  const meshIds: number[] = new Array(basePolygons.length).fill(0);
  const depthBiases: number[] = new Array(basePolygons.length).fill(0);
  const castShadowFlags: boolean[] = new Array(basePolygons.length).fill(false);
  const receiveShadowFlags: boolean[] = new Array(basePolygons.length).fill(false);
  let anyDepthBias = false, anyCastShadow = false, anyReceiveShadow = false;
  let nextMeshId = 1;
  const sortable: Array<{ overlay: GlyphSceneOverlay; ownMeshIds: ReadonlySet<number>; order: number; mountIndex: number; overlayIndex: number }> = [];
  const hotspots: Hotspot[] = [];
  let textureSamplers: Map<string, TextureSampler> | null = null;
  for (let mountIndex = 0; mountIndex < objects.length; mountIndex++) {
    const object = objects[mountIndex]!;
    const ownMeshIds = new Set<number>();
    for (const spec of object.meshes) {
      assertCompileMeshOptionsRepresentable(object.id, spec.name, spec.options, mode);
      const meshId = nextMeshId++;
      ownMeshIds.add(meshId);
      const bias = spec.options?.depthBias ?? 0;
      const cast = spec.options?.castShadow === true;
      const receive = spec.options?.receiveShadow === true;
      if (bias !== 0) anyDepthBias = true;
      if (cast) anyCastShadow = true;
      if (receive) anyReceiveShadow = true;
      for (const p of spec.polygons) {
        polygons.push(p);
        meshIds.push(meshId);
        depthBiases.push(bias);
        castShadowFlags.push(cast);
        receiveShadowFlags.push(receive);
      }
    }
    const overlays = object.overlays ?? [];
    for (let overlayIndex = 0; overlayIndex < overlays.length; overlayIndex++) {
      const overlay = overlays[overlayIndex]!;
      sortable.push({ overlay, ownMeshIds, order: overlay.order ?? 0, mountIndex, overlayIndex });
    }
    for (const h of object.hotspots ?? []) hotspots.push({ id: h.id, at: h.at });
    if (object.textureSamplers) {
      textureSamplers ??= new Map();
      for (const [name, sampler] of object.textureSamplers) {
        textureSamplers.set(encodeGlyphSceneObjectSamplerKey(object.id, name), sampler);
      }
    }
  }
  // Same sort key `applyGlyphSceneObjectOverlays` uses: `order`, then mount
  // order, then declaration order within the object.
  sortable.sort((a, b) => (a.order - b.order) || (a.mountIndex - b.mountIndex) || (a.overlayIndex - b.overlayIndex));
  const overlayEntries: CompileOverlayEntry[] = sortable.map(({ overlay, ownMeshIds }) => ({ overlay, ownMeshIds }));
  return {
    polygons, polygonMeshIds: overlayEntries.length > 0 ? meshIds : undefined, overlayEntries, hotspots, textureSamplers,
    depthBiases: anyDepthBias ? depthBiases : undefined,
    castShadowFlags: anyCastShadow ? castShadowFlags : undefined,
    receiveShadowFlags: anyReceiveShadow ? receiveShadowFlags : undefined,
  };
}

/**
 * The overlay registry, standalone (no scene) — `createGlyphScene.ts`'s own
 * `applyGlyphSceneObjectOverlays` mirrored for a Node-safe, DOM-free caller.
 * `toWorld` is the identity function: `compileScene` mounts every object at
 * the identity transform (see `CompileSceneOptions.objects`'s own doc), and
 * `transformObjectPoint(p, {})` reduces to identity anyway, so this is
 * exactly the frame a live `scene.addObject(object)` (no transform argument)
 * would hand the SAME overlay. `layer` is always `undefined` here — a direct
 * `rasterizeContext` caller (which is what `compileScene` is) supplies none
 * (AGENTS.md's "Post-rasterize cell hook" paragraph).
 */
function applyCompileObjectOverlays(
  grid: CellGrid,
  camera: GlyphCamera,
  cellAspect: number,
  overlayEntries: readonly CompileOverlayEntry[],
): CellGrid {
  const arbiter = createGlyphLabelArbiter();
  for (const { overlay, ownMeshIds } of overlayEntries) {
    const frame: GlyphOverlayFrame = {
      camera,
      cols: grid.cols,
      rows: grid.rows,
      cellAspect,
      layer: undefined,
      toWorld: (p) => p,
      ownMeshIds,
      labels: arbiter,
    };
    overlay.stamp(grid, frame);
  }
  arbiter.resolve(grid);
  return grid;
}

/**
 * Contract 9's merge order, standalone: an object's own `textureSamplers`
 * (already namespace-encoded by `mergeCompileObjects`) first, this call's
 * own explicit `textureSamplers` winning any key collision — the same order
 * `resolvedTextureSamplers()` merges them in at runtime.
 */
function resolveCompileTextureSamplers(
  objectSamplers: Map<string, TextureSampler> | null,
  explicit: ReadonlyMap<string, TextureSampler> | null | undefined,
): ReadonlyMap<string, TextureSampler> | undefined {
  const hasObject = objectSamplers !== null && objectSamplers.size > 0;
  const hasExplicit = explicit != null && explicit.size > 0;
  if (!hasObject && !hasExplicit) return undefined;
  const merged = new Map<string, TextureSampler>(objectSamplers ?? []);
  if (hasExplicit) for (const [key, sampler] of explicit) merged.set(key, sampler);
  return merged;
}

export function compileScene(opts: CompileSceneOptions): CompileSceneResult {
  // Library-identical defaults (see createGlyphScene).
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const cellAspect = opts.cellAspect ?? 2.0;
  const mode: RenderMode = opts.mode ?? "solid";
  const useColors = opts.useColors ?? true;
  const camera = opts.camera ?? createGlyphPerspectiveCamera();

  const polygons = opts.autoCenter ? recenterPolygons(opts.polygons) : opts.polygons;

  if (opts.glyphOutput === "semantic") {
    if (mode !== "solid") throw new RangeError("glyphcss: semantic glyph output requires solid mode.");
    if (!opts.sceneManifest || !opts.dictionary) {
      throw new TypeError("glyphcss: semantic glyph output requires sceneManifest and dictionary.");
    }
    if (opts.objects && opts.objects.length > 0) {
      // A semantic frame's `sceneManifest`/`dictionary` describe the
      // caller's OWN `polygons` 1:1 (AGENTS.md's "Semantic output" — the
      // lineage is a polygon → surface → instance → class identity map);
      // an object's meshes have no corresponding manifest entries to align
      // with, and overlay stamping never runs under `glyphOutput: "semantic"`
      // at runtime either (`createGlyphScene.ts`'s `ctx.transformCells` is
      // only ever set when `options.glyphOutput === "visible"`). Reject
      // explicitly rather than silently drop the objects or misalign the
      // manifest.
      throw new TypeError('glyphcss: compileScene does not support "objects" with glyphOutput: "semantic".');
    }
    const frame = buildGlyphControlFrame({
      polygons,
      scene: opts.sceneManifest,
      dictionary: opts.dictionary,
      camera,
      grid: { cols, rows, cellAspect },
      mode,
      directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
      ambientLight: opts.ambientLight ?? { intensity: 0.4 },
      glyphPalette: opts.glyphPalette ?? "default",
      smoothShading: opts.smoothShading ?? false,
      creaseAngle: opts.creaseAngle ?? 60,
      doubleSided: opts.doubleSided ?? false,
      supersample: opts.supersample ?? 1,
      shadow: opts.shadow,
    });
    const chars = frame.semanticAscii.replace(/\n/g, "").split("");
    const colors = Array.from(frame.semanticColor, (packed) => packed === 0
      ? null
      : `#${(packed & 0xffffff).toString(16).padStart(6, "0")}`);
    const output = encodeGlyphBuffers(chars, colors, cols, rows, useColors);
    const inner = useColors ? output : escapeHtml(output);
    return {
      html: `<pre class="glyph-output">${inner}</pre>`,
      inner,
      cols,
      rows,
      cellAspect,
      grid: buildCellGrid(chars, colors, null, cols, rows),
      hotspots: [],
    };
  }
  if (opts.glyphOutput !== undefined && opts.glyphOutput !== "visible") {
    throw new TypeError('glyphcss: glyphOutput must be "visible" or "semantic".');
  }

  // Contract 3 (AGENTS.md "Compilation"): fold every mounted object's meshes
  // into the flat polygon list, gather its overlays into ONE ordered
  // registry, and flatten its hotspots — a no-op, `polygons` unchanged by
  // reference, when `opts.objects` is absent (the byte-identity gate).
  const merged = mergeCompileObjects(polygons, opts.objects, mode);
  const textureSamplers = resolveCompileTextureSamplers(merged.textureSamplers, opts.textureSamplers);

  const ctx = buildRasterizeContext({
    camera,
    grid: { cols, rows, cellAspect },
    polygons: merged.polygons,
    mode,
    directionalLight: opts.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: opts.ambientLight ?? { intensity: 0.4 },
    glyphPalette: opts.glyphPalette ?? "default",
    charMode: opts.charMode,
    hiddenLines: opts.hiddenLines,
    solidWeightRamp: opts.solidWeightRamp,
    colorTolerance: opts.colorTolerance,
    colorEncoding: opts.colorEncoding,
    atlasPalette: opts.atlasPalette,
    fontAtlas: opts.fontAtlas,
    useColors,
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    shadow: opts.shadow,
    polygonMeshIds: merged.polygonMeshIds,
    retainWinnerMesh: merged.overlayEntries.length > 0,
    // Fix round 6, P1-1: a SEPARATE flag from `retainWinnerMesh` above — an
    // object's own overlay needs real occlusion data under wireframe/ink
    // too (`rasterize.ts`'s `buildSurfaceOcclusionMap`, mode-independent),
    // not only in solid mode. `compileScene` has no effects concept (no
    // per-object EFFECT targeting to keep solid-only), so the two flags are
    // always equal here — kept separate anyway to match
    // `RasterizeContextOptions.retainOverlayOcclusion`'s own contract.
    retainOverlayOcclusion: merged.overlayEntries.length > 0,
    textureSamplers,
    depthBiases: merged.depthBiases,
    castShadowFlags: merged.castShadowFlags,
    receiveShadowFlags: merged.receiveShadowFlags,
  });
  // Per-cell texture sampling from a fetched URL needs browser image
  // decoding (not Node-safe), so the static compile renders from material /
  // vertex colors for that case — the same fallback the runtime uses before
  // its async samplers resolve. `textureSamplers` above (explicit +
  // object-owned) is PROCEDURAL, decoded pixels handed in directly with no
  // fetch, so it works here exactly as it does at runtime.

  // Overlays run inside `ctx.transformCells`, exactly as before — attached
  // ONLY when an overlay actually exists, so `charMode: "halfblock"`/
  // `"quadrant"`'s own "no transformCells hook" no-op rule is untouched on
  // the ordinary no-objects path. `grid` is captured SEPARATELY, through
  // `ctx.captureCells` (F5b fix round 1 — P1-1/P1-2): an independent
  // observer `rasterize()` itself now supports, called from INSIDE the same
  // single pass that builds `inner`, after any `transformCells` hook has
  // already run — never a second `rasterizeToCells` traversal (which used to
  // double every ordinary compile's rasterization cost, and could pick
  // DIFFERENT random glyphs than `inner` in wireframe/voxel mode, since two
  // separate walks each roll their own `Math.random()`). `captureCells` is
  // a distinct field from `transformCells` — `wantsHalfblockSolid`/
  // `wantsQuadrantSolid` and every mode's "safe" encoder choice key on
  // `transformCells` alone, so attaching it changes zero rendered bytes; a
  // halfblock/quadrant render's own early-return path never calls it at
  // all, which is exactly how `grid` ends up `null` there (see
  // `CompileSceneResult.grid`'s own doc).
  let capturedGrid: CellGrid | null = null;
  ctx.captureCells = (grid) => { capturedGrid = cloneCellGrid(grid); };
  if (merged.overlayEntries.length > 0) {
    ctx.transformCells = (grid) => {
      applyCompileObjectOverlays(grid, camera, cellAspect, merged.overlayEntries);
      return grid;
    };
  }

  const output = rasterize(ctx);
  // D2 round 7 (`@glyphcss/diagrams/3d`'s "blocks" charset + its label
  // overlay): `rasterize.ts`'s own halfblock/quadrant + `transformCells`
  // merge (AGENTS.md's "Render modes") now calls `scene.captureCells` too
  // (via the SAME `applyCellHook` every solid-mode render already routes
  // through), but what it captures there is the ORDINARY single-colour
  // post-hook result — never the real dual-colour `▀`/`▄`/quadrant output
  // `output`/`inner` actually contain. A `CellGrid` cell still has exactly
  // one glyph and one colour, so a dual-colour cell still has NO honest
  // single-`CellGrid` representation (this field's own doc, unchanged by
  // that round) — `grid` stays `null` for `halfblock`/`quadrant`
  // regardless of whether an overlay is mounted, matching the charMode's
  // own pre-existing no-overlay contract exactly, rather than silently
  // returning a grid that disagrees with what was actually rendered.
  const dualColourCharMode = mode === "solid" && (opts.charMode === "halfblock" || opts.charMode === "quadrant");
  const grid = dualColourCharMode ? null : capturedGrid;
  const hotspots = projectHotspots(merged.hotspots, camera, cols, rows, cellAspect);
  // Colored output is HTML (spans); plain output is text → escape for inlining.
  const inner = useColors ? output : escapeHtml(output);
  return {
    html: `<pre class="glyph-output">${inner}</pre>`,
    inner,
    cols,
    rows,
    cellAspect,
    grid,
    hotspots,
  };
}
