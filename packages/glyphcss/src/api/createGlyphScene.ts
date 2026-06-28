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
} from "@glyphcss/core";
import { buildTextureSamplers } from "@glyphcss/core";
import type { GlyphCamera } from "./createGlyphCamera";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { buildRasterizeContext } from "./rasterizeContext";
import type { ShadeCache, TemporalHistory } from "./rasterizeContext";
import { rasterize, computeOcclusionIds } from "../render/rasterize";
import { injectGlyphBaseStyles } from "../styles/styles";
import { projectHotspots } from "./projectHotspots";
import type { GlyphDirectionalLight, GlyphAmbientLight, GlyphMeshTransform, GlyphShadowOptions } from "./types";
export type { GlyphMeshTransform, GlyphShadowOptions } from "./types";

export interface GlyphSceneOptions {
  /** Render mode: "wireframe" | "solid". Default "solid". */
  mode?: RenderMode;
  /** Named glyph palette. Defaults to "default". */
  glyphPalette?: string;
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
  /** Shadow-map configuration. `undefined` (default) = no shadows. */
  shadow?: GlyphShadowOptions;
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
  addHotspot(opts: GlyphHotspotOptions, onClick?: () => void): GlyphHotspotHandle;
  /** Force an immediate re-rasterize. Normally called automatically on add/remove/setOptions. */
  rerender(): void;
  setOptions(opts: Partial<GlyphSceneOptions>): void;
  getOptions(): GlyphSceneOptions;
  /**
   * Re-measure the host's character cell (font-size, line-height) and adapt
   * `cols`/`rows`/`cellAspect`. Only meaningful when `autoSize` was enabled.
   * Call when something outside the scene options changes the cell size —
   * e.g., the consumer overrode `pre.style.lineHeight` directly. The internal
   * `ResizeObserver` already handles host-size changes automatically.
   */
  fit(): void;
  destroy(): void;
}

interface MeshEntry {
  id: number;
  polygons: Polygon[];
  transform: GlyphMeshTransform;
}

type InternalOptions = Omit<Required<GlyphSceneOptions>, "shadow"> & { shadow: GlyphShadowOptions | undefined };

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
  }));
}

export function createGlyphScene(
  host: HTMLElement,
  opts: GlyphSceneOptions = {},
): GlyphSceneHandle {
  injectGlyphBaseStyles(host.ownerDocument ?? undefined);

  const options: InternalOptions = {
    mode: opts.mode ?? "solid",
    glyphPalette: opts.glyphPalette ?? "default",
    useColors: opts.useColors ?? true,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cellAspect: opts.cellAspect ?? 2.0,
    directionalLight: opts.directionalLight ?? { direction: [-0.5, -0.7, -0.5], intensity: 1 },
    ambientLight: opts.ambientLight ?? { intensity: 0.4 },
    camera: opts.camera ?? createGlyphPerspectiveCamera(),
    smoothShading: opts.smoothShading ?? false,
    creaseAngle: opts.creaseAngle ?? 60,
    doubleSided: opts.doubleSided ?? false,
    supersample: opts.supersample ?? 1,
    depthEpsilon: opts.depthEpsilon ?? 0,
    temporalBlend: opts.temporalBlend ?? 0,
    autoSize: opts.autoSize ?? false,
    shadow: opts.shadow,
  };

  // Build DOM
  const sceneEl = host.ownerDocument!.createElement("div");
  sceneEl.className = "glyph-scene";
  const pre = host.ownerDocument!.createElement("pre") as HTMLPreElement;
  pre.className = "glyph-output";
  const hotspotLayer = host.ownerDocument!.createElement("div");
  hotspotLayer.className = "glyph-hotspot-layer";
  sceneEl.appendChild(pre);
  sceneEl.appendChild(hotspotLayer);
  host.appendChild(sceneEl);

  const meshes = new Map<number, MeshEntry>();
  const hotspots: Array<{ hotspot: Hotspot; el: HTMLElement; onClick?: () => void }> = [];
  let pendingRender = false;

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
  function invalidateShading(): void {
    shadeCache.iA.length = 0;
    shadeCache.iB.length = 0;
    shadeCache.iC.length = 0;
    shadeCache.lit.length = 0;
  }

  // Decoded texture pixel samplers (for per-cell texture rendering). Built async
  // from all mesh polygons that carry a texture; null until decoded / when none.
  // Polygons without a texture+uvs simply render flat, so this is a no-op cost
  // for untextured scenes.
  let textureSamplers: Map<string, TextureSampler> | null = null;
  let textureToken = 0;
  function refreshTextureSamplers(): void {
    const polys: Polygon[] = [];
    for (const entry of meshes.values()) for (const p of entry.polygons) if (p.texture || p.material?.texture) polys.push(p);
    if (polys.length === 0) { if (textureSamplers) { textureSamplers = null; scheduleRender(); } return; }
    const token = ++textureToken;
    void buildTextureSamplers(polys).then((map) => {
      if (token !== textureToken) return; // superseded by a newer mesh change
      textureSamplers = map.size > 0 ? map : null;
      scheduleRender();
    });
  }

  function scheduleRender(): void {
    if (pendingRender) return;
    pendingRender = true;
    Promise.resolve().then(() => {
      pendingRender = false;
      doRender();
    });
  }

  function doRender(): void {
    // Gather all polygons after transforms.
    const allPolygons: Polygon[] = [];
    const castShadowFlags: boolean[] = [];
    const receiveShadowFlags: boolean[] = [];
    const depthBiases: number[] = [];
    let anyDepthBias = false;
    const detailEntries: MeshEntry[] = [];
    for (const entry of meshes.values()) {
      // Meshes with their own cell metrics render in a separate, finer <pre>.
      if (isDetailMesh(entry.transform)) { detailEntries.push(entry); continue; }
      const transformed = applyTransform(entry.polygons, entry.transform);
      const cast = entry.transform.castShadow ?? false;
      const receive = entry.transform.receiveShadow ?? false;
      const bias = entry.transform.depthBias ?? 0;
      if (bias !== 0) anyDepthBias = true;
      for (const p of transformed) {
        allPolygons.push(p);
        castShadowFlags.push(cast);
        receiveShadowFlags.push(receive);
        depthBiases.push(bias);
      }
    }

    // Cross-layer occlusion: if any OPAQUE detail mesh exists, build ONE shared
    // camera-depth buffer (base meshes + opaque detail meshes) at the base grid.
    // Each opaque layer then blanks cells where another layer is nearer. Transparent
    // detail meshes don't participate (they neither occlude nor are occluded).
    // Layer ids: base meshes share id 0; each opaque detail mesh uses its own id.
    const BASE_LAYER = 0;
    let occShared: { idMap: Int32Array; cols: number; rows: number; cwB: number; chB: number } | null = null;
    const opaqueDetails = detailEntries.filter((e) => e.transform.transparent !== true);
    if (opaqueDetails.length > 0) {
      const bc = baseCellMetrics();
      if (bc.w > 0 && bc.h > 0) {
        const groups: { polygons: Polygon[]; id: number }[] = [{ polygons: allPolygons, id: BASE_LAYER }];
        for (const e of opaqueDetails) groups.push({ polygons: applyTransform(e.polygons, e.transform), id: e.id });
        const idMap = computeOcclusionIds(groups, options.camera, options.cols, options.rows, options.cellAspect);
        occShared = { idMap, cols: options.cols, rows: options.rows, cwB: bc.w, chB: bc.h };
      }
    }

    const ctx = buildRasterizeContext({
      camera: options.camera,
      grid: { cols: options.cols, rows: options.rows, cellAspect: options.cellAspect },
      polygons: allPolygons,
      mode: options.mode,
      directionalLight: options.directionalLight,
      ambientLight: options.ambientLight,
      glyphPalette: options.glyphPalette,
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
    });
    ctx.shadeCache = shadeCache;
    ctx.textureSamplers = textureSamplers;
    ctx.temporalHistory = temporalHistory;
    // Base layer occludes 1:1 against the shared id-map (its grid IS the ref grid).
    ctx.occlusion = occShared
      ? { idMap: occShared.idMap, layerId: BASE_LAYER, cols: occShared.cols, rows: occShared.rows, colScale: 1, colOffset: 0.5, rowScale: 1, rowOffset: 0.5 }
      : null;

    // Optional perf instrumentation: set `globalThis.__glyphPerf = {}` to
    // record per-render rasterize vs DOM-write timings into it. Zero cost when
    // the flag is unset. Used by the glyphcss perf benchmark to decide whether
    // the bottleneck is JS rasterization or the DOM/paint of the <pre>.
    const perf = (globalThis as { __glyphPerf?: { raster?: number[]; dom?: number[]; polys?: number[] } }).__glyphPerf;
    const tStart = perf ? performance.now() : 0;

    const output = rasterize(ctx);
    const tRaster = perf ? performance.now() : 0;

    if (options.useColors) {
      pre.innerHTML = output;
    } else {
      pre.textContent = output;
    }

    if (perf) {
      const tDom = performance.now();
      (perf.raster ??= []).push(tRaster - tStart);
      (perf.dom ??= []).push(tDom - tRaster);
      (perf.polys ??= []).push(allPolygons.length);
    }

    // Detail meshes — each in its own finer, translated <pre> overlay.
    renderDetailLayers(detailEntries, occShared);

    // Update hotspot positions.
    updateHotspots();
  }

  // A mesh "pops out" into its own <pre> when it declares its own cell metrics OR
  // asks to be transparent (a shared-pre mesh always occludes — one depth buffer —
  // so non-occlusion requires its own layer).
  function isDetailMesh(t: GlyphMeshTransform): boolean {
    return t.density != null || t.fontSize != null || t.lineHeight != null || t.transparent === true;
  }

  // Measure one monospace cell (px) from a live <pre>, honoring its inherited /
  // overridden font-size + line-height. Multi-line probe so sub-1 line-heights
  // measure the true per-line advance (see measureCell for the rationale).
  function measureCellOf(el: HTMLElement): { w: number; h: number } {
    const LINES = 20;
    const probe = host.ownerDocument!.createElement("span");
    probe.textContent = Array(LINES).fill("M").join("\n");
    probe.style.cssText =
      "position:absolute;visibility:hidden;font-family:inherit;font-size:inherit;line-height:inherit;white-space:pre;padding:0;margin:0";
    el.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { w: r.width || 8, h: r.height ? r.height / LINES : 16 };
  }

  // Cell-size measurements force a synchronous layout flush, so they're cached and
  // only refreshed when the cell metrics actually change — NOT per camera frame.
  // Base cache invalidated by fit()/setOptions; per-detail cache keyed on its
  // font-size+line-height.
  let baseCellCache: { w: number; h: number } | null = null;
  function baseCellMetrics(): { w: number; h: number } {
    return (baseCellCache ??= measureCellOf(pre));
  }
  let baseFontPxCache: number | null = null;
  function baseFontPx(): number {
    return (baseFontPxCache ??= parseFloat((host.ownerDocument!.defaultView ?? globalThis).getComputedStyle(pre).fontSize) || 13);
  }
  const detailLayers = new Map<number, { pre: HTMLPreElement; key: string; cw: number; ch: number }>();

  /**
   * Render each detail mesh into its own absolutely-positioned <pre>, sized to
   * the mesh silhouette and translated to its on-screen position. The mesh is
   * rendered centered with the camera zoom scaled by the base/detail cell-height
   * ratio (so it occupies the same screen footprint as in the shared grid, just
   * with finer glyphs), then translated so its centroid lands where the shared
   * camera projects it. Exact for orthographic cameras.
   */
  function renderDetailLayers(
    entries: MeshEntry[],
    occShared: { idMap: Int32Array; cols: number; rows: number; cwB: number; chB: number } | null,
  ): void {
    // Drop <pre>s for meshes that are gone or no longer detail.
    for (const [id, layer] of detailLayers) {
      if (!entries.some((e) => e.id === id)) { layer.pre.remove(); detailLayers.delete(id); }
    }
    if (entries.length === 0) return;

    const camera = options.camera;
    const baseZoom = camera.zoom;
    const colsB = options.cols, rowsB = options.rows, caB = options.cellAspect;
    const baseCell = baseCellMetrics();
    const cwB = baseCell.w, chB = baseCell.h;
    if (!(cwB > 0) || !(chB > 0)) return; // not laid out yet (SSR / detached)

    try {
      for (const entry of entries) {
        let layer = detailLayers.get(entry.id);
        if (!layer) {
          const el = host.ownerDocument!.createElement("pre") as HTMLPreElement;
          el.className = "glyph-output glyph-output--detail";
          el.style.cssText =
            "position:absolute;top:0;left:0;margin:0;transform-origin:top left;pointer-events:none";
          sceneEl.insertBefore(el, hotspotLayer);
          layer = { pre: el, key: "", cw: 0, ch: 0 };
          detailLayers.set(entry.id, layer);
        }
        const dpre = layer.pre;
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
            dpre.style.fontSize = `${baseFontPx() / density}px`;
            dpre.style.lineHeight = "";
            layer.key = key; layer.cw = cwB / density; layer.ch = chB / density;
          }
        } else {
          // legacy escape hatch: explicit fontSize / lineHeight (CSS-measured).
          const fs = entry.transform.fontSize;
          const fsStr = fs == null ? "" : typeof fs === "number" ? `${fs}px` : fs;
          const lhStr = entry.transform.lineHeight == null ? "" : String(entry.transform.lineHeight);
          const key = `${fsStr}|${lhStr}`;
          if (layer.key !== key) {
            dpre.style.fontSize = fsStr;
            dpre.style.lineHeight = lhStr;
            const m = measureCellOf(dpre);
            layer.key = key; layer.cw = m.w; layer.ch = m.h;
          }
        }
        const cwD = layer.cw, chD = layer.ch;
        if (!(cwD > 0) || !(chD > 0)) continue;
        const caD = chD / cwD;
        const zoomD = baseZoom * (chB / chD);

        // Transform to world, then recenter on the mesh bbox so it sits at the
        // detail grid's center (the camera centers projection at [0.5,0.5]).
        const tp = applyTransform(entry.polygons, entry.transform);
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (const p of tp) for (const v of p.vertices) {
          if (v[0] < mnx) mnx = v[0]; if (v[1] < mny) mny = v[1]; if (v[2] < mnz) mnz = v[2];
          if (v[0] > mxx) mxx = v[0]; if (v[1] > mxy) mxy = v[1]; if (v[2] > mxz) mxz = v[2];
        }
        const ctr: Vec3 = [(mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2];
        const centered: Polygon[] = tp.map((p) => ({
          ...p, vertices: p.vertices.map((v) => [v[0] - ctr[0], v[1] - ctr[1], v[2] - ctr[2]] as Vec3),
        }));

        // Size the detail grid to the mesh's screen extent at the scaled zoom.
        camera.zoom = zoomD;
        const REF = 4000;
        let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
        for (const p of centered) for (const v of p.vertices) {
          const pr = camera.project(v, REF, REF, caD);
          if (!isFinite(pr[0]) || !isFinite(pr[1])) continue;
          if (pr[0] < minc) minc = pr[0]; if (pr[0] > maxc) maxc = pr[0];
          if (pr[1] < minr) minr = pr[1]; if (pr[1] > maxr) maxr = pr[1];
        }
        const PAD = 2;
        const colsD = Math.max(2, Math.ceil(maxc - minc) + PAD * 2);
        const rowsD = Math.max(2, Math.ceil(maxr - minr) + PAD * 2);

        // On-screen placement: project the centroid with the SHARED camera (base
        // zoom). Computed BEFORE rasterize because the occlusion map needs the
        // translate to map this layer's cells into the shared depth grid.
        camera.zoom = baseZoom;
        const cp = camera.project(ctr, colsB, rowsB, caB);
        const tx = cp[0] * cwB - (colsD * cwD) / 2;
        const ty = cp[1] * chB - (rowsD * chD) / 2;

        // Opaque detail layers occlude against the shared id-map (owner === this
        // mesh's id → keep, so it never occludes itself); transparent ones don't.
        const occ = (occShared && entry.transform.transparent !== true)
          ? {
              idMap: occShared.idMap, layerId: entry.id, cols: occShared.cols, rows: occShared.rows,
              colScale: cwD / cwB, colOffset: (tx + 0.5 * cwD) / cwB,
              rowScale: chD / chB, rowOffset: (ty + 0.5 * chD) / chB,
            }
          : null;

        camera.zoom = zoomD;
        const ctx = buildRasterizeContext({
          camera,
          grid: { cols: colsD, rows: rowsD, cellAspect: caD },
          polygons: centered,
          mode: options.mode,
          directionalLight: options.directionalLight,
          ambientLight: options.ambientLight,
          glyphPalette: options.glyphPalette,
          useColors: options.useColors,
          smoothShading: options.smoothShading,
          creaseAngle: options.creaseAngle,
          doubleSided: options.doubleSided,
          supersample: options.supersample,
          depthEpsilon: options.depthEpsilon,
          temporalBlend: 0,
          shadow: undefined,
        });
        ctx.textureSamplers = textureSamplers;
        ctx.occlusion = occ;
        const out = rasterize(ctx);
        if (options.useColors) dpre.innerHTML = out; else dpre.textContent = out;
        dpre.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
      }
    } finally {
      camera.zoom = baseZoom;
    }
  }

  function updateHotspots(): void {
    const { cols, rows, cellAspect, camera } = options;
    const cells = projectHotspots(
      hotspots.map((h) => h.hotspot),
      camera,
      cols,
      rows,
      cellAspect,
    );

    // Compute character cell dimensions from the <pre> bounding box.
    const preRect = pre.getBoundingClientRect();
    const cellW = cols > 0 ? preRect.width / cols : 8;
    const cellH = rows > 0 ? preRect.height / rows : 16;

    for (let i = 0; i < hotspots.length; i++) {
      const { el } = hotspots[i]!;
      const cell = cells[i]!;
      if (!cell.visible) {
        el.style.display = "none";
      } else {
        el.style.display = "";
        // Anchor at the CELL CENTER (not top-left). The `.glyph-hotspot` CSS
        // rule applies `transform: translate(-50%, -50%)` so the visible
        // label/dot is centered on this point — and the rendered ASCII glyph
        // at this cell is also drawn at the cell center, so the two visually
        // coincide.
        el.style.left = `${(cell.col + 0.5) * cellW}px`;
        el.style.top = `${(cell.row + 0.5) * cellH}px`;
        el.style.zIndex = String(Math.round(cell.depth * 1000));
      }
    }
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
      get polygons() { return polygons; },
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
    doRender();
  }

  function setOptions(partial: Partial<GlyphSceneOptions>): void {
    if (partial.mode !== undefined) options.mode = partial.mode;
    if (partial.glyphPalette !== undefined) options.glyphPalette = partial.glyphPalette;
    if (partial.useColors !== undefined) options.useColors = partial.useColors;
    if (partial.cols !== undefined) options.cols = partial.cols;
    if (partial.rows !== undefined) options.rows = partial.rows;
    if (partial.cellAspect !== undefined) options.cellAspect = partial.cellAspect;
    if (partial.directionalLight !== undefined) options.directionalLight = partial.directionalLight;
    if (partial.ambientLight !== undefined) options.ambientLight = partial.ambientLight;
    if (partial.camera !== undefined) options.camera = partial.camera;
    if (partial.smoothShading !== undefined) options.smoothShading = partial.smoothShading;
    if (partial.creaseAngle !== undefined) options.creaseAngle = partial.creaseAngle;
    if ("shadow" in partial) options.shadow = partial.shadow;
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
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    meshes.clear();
    if (host.contains(sceneEl)) host.removeChild(sceneEl);
  }

  scheduleRender();

  return {
    get host() { return host; },
    get output() { return pre; },
    get camera() { return options.camera; },
    add,
    addHotspot,
    rerender,
    setOptions,
    getOptions,
    fit: fitToHost,
    destroy,
  };
}
