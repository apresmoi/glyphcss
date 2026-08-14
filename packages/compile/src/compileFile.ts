/**
 * compileFile — load a mesh file and compile it to a static `<pre>`.
 *
 * Defaults mirror the glyphcss library exactly (perspective camera, cols 80 /
 * rows 24 / cellAspect 2.0, solid mode, colors on, etc.). Pass camera angle /
 * zoom / `autoCenter` to frame a model, or `autoFit` to size the grid + zoom to
 * the content automatically (handy for the terminal — no cols/rows needed).
 */
import {
  buildGlyphControlFrame,
  compileScene,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  cropGlyphInner,
} from "glyphcss";
import type { CompileSceneResult, GlyphCamera, GlyphControlFrame, GlyphControlSceneManifest, GlyphObjectDictionary } from "glyphcss";
import type { MeshResolution, RenderMode, Polygon } from "@glyphcss/core";
import { loadMeshFromFile } from "./loadMeshFromFile";
import { verifyGlyphLabelSidecar, type GlyphLabelSidecar } from "./labelSidecar";

export interface CompileFileOptions {
  /** Appearance-shaded (default) or dictionary-semantic static output. */
  glyphOutput?: "visible" | "semantic";
  /** Versioned post-load polygon lineage required for semantic output. */
  sceneManifest?: GlyphControlSceneManifest;
  /** Versioned object dictionary required for semantic output. */
  dictionary?: GlyphObjectDictionary;
  /** Versioned scene/dictionary plus an optional verified optimized-loader remap. */
  labelSidecar?: GlyphLabelSidecar;
  /** Camera projection. Default: "perspective" (the library default). */
  projection?: "perspective" | "orthographic";
  rotX?: number;
  rotY?: number;
  zoom?: number;
  /** Perspective only. */
  distance?: number;
  perspective?: number;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  glyphPalette?: string;
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
  doubleSided?: boolean;
  supersample?: number;
  /** Recenter the mesh bbox to the origin (matches `<glyph-mesh auto-center>`). Default false. */
  autoCenter?: boolean;
  /**
   * Auto-fit: size the grid + zoom so the whole model shows, cropped tight.
   * `by` is the axis to fit to `target` (the other axis adapts to the content):
   * fit `cols` (width) when you give a column budget, `rows` (height) for a row
   * budget. Implies `autoCenter`.
   */
  autoFit?: { target: number; by: "cols" | "rows" };
  /** Mesh-optimization quality passed to `loadMesh`. Default: the loadMesh default ("lossy"). */
  meshResolution?: MeshResolution;
  /** Explicit companion `.mtl` path for OBJ (overrides sibling auto-detection). */
  mtlUrl?: string;
}

function worldMaxDim(polys: Polygon[]): number {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const p of polys) for (const v of p.vertices) {
    if (v[0] < mnx) mnx = v[0]; if (v[0] > mxx) mxx = v[0];
    if (v[1] < mny) mny = v[1]; if (v[1] > mxy) mxy = v[1];
    if (v[2] < mnz) mnz = v[2]; if (v[2] > mxz) mxz = v[2];
  }
  if (!isFinite(mnx)) return 1;
  return Math.max(mxx - mnx, mxy - mny, mxz - mnz, 1e-6);
}

/** Content extent (in cells) of a rendered inner string, tags stripped. */
function measureContent(inner: string): { w: number; h: number } {
  const lines = inner.replace(/<[^>]*>/g, "").split("\n");
  let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
  lines.forEach((l, r) => {
    for (let c = 0; c < l.length; c++) if (l[c] !== " ") {
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
  });
  return maxC < 0 ? { w: 0, h: 0 } : { w: maxC - minC + 1, h: maxR - minR + 1 };
}

/**
 * compilePolygons — render polygons you already have (a primitive, custom JSON,
 * etc.) to a `<pre>`, with the same camera / auto-fit logic as `compileFile`.
 * Pure + synchronous (no file I/O).
 */
export function compilePolygons(polygons: Polygon[], options: CompileFileOptions = {}): CompileSceneResult {
  const labels = options.labelSidecar ? verifyGlyphLabelSidecar(polygons, options.labelSidecar) : undefined;
  if (!labels && (options.sceneManifest || options.dictionary)) {
    if (!options.sceneManifest || !options.dictionary) throw new TypeError("glyphcss: sceneManifest and dictionary must be supplied together.");
    verifyGlyphLabelSidecar(polygons, { schemaVersion: "glyph-label-sidecar/v1", scene: options.sceneManifest, dictionary: options.dictionary });
  }
  const sceneManifest = labels?.sceneManifest ?? options.sceneManifest;
  const dictionary = labels?.dictionary ?? options.dictionary;
  const buildCam = (zoom?: number): GlyphCamera =>
    options.projection === "orthographic"
      ? createGlyphOrthographicCamera({ rotX: options.rotX, rotY: options.rotY, zoom })
      : createGlyphPerspectiveCamera({ rotX: options.rotX, rotY: options.rotY, zoom, distance: options.distance, perspective: options.perspective });

  const shared = {
    autoCenter: options.autoCenter,
    cellAspect: options.cellAspect,
    mode: options.mode,
    glyphPalette: options.glyphPalette,
    useColors: options.useColors,
    smoothShading: options.smoothShading,
    creaseAngle: options.creaseAngle,
    doubleSided: options.doubleSided,
    supersample: options.supersample,
    glyphOutput: options.glyphOutput,
    sceneManifest,
    dictionary,
  };

  if (options.autoFit && options.autoFit.target > 0) {
    const { target, by } = options.autoFit;
    // Probe at a zoom that keeps the model well inside a big grid, measure its
    // cell extent, then scale zoom so the chosen axis hits the target — and crop.
    const probeZoom = 40 / worldMaxDim(polygons);
    const probe = compileScene({ polygons, camera: buildCam(probeZoom), cols: 200, rows: 120, ...shared, autoCenter: true });
    const m = measureContent(probe.inner);
    if (m.w > 0 && m.h > 0) {
      const scale = by === "rows" ? target / m.h : target / m.w;
      const zoom = probeZoom * scale;
      // Pad the grid generously (perspective scaling isn't perfectly linear) —
      // the final crop trims it back to the exact content (the other axis grows
      // to whatever shows the whole model).
      const cols = Math.ceil(m.w * scale * 1.4) + 6;
      const rows = Math.ceil(m.h * scale * 1.4) + 6;
      const full = compileScene({ polygons, camera: buildCam(zoom), cols, rows, ...shared, autoCenter: true });
      const inner = cropGlyphInner(full.inner);
      const lines = inner.split("\n");
      const w = lines.reduce((a, l) => Math.max(a, l.replace(/<[^>]*>/g, "").length), 0);
      return { html: `<pre class="glyph-output">${inner}</pre>`, inner, cols: w, rows: lines.length, cellAspect: options.cellAspect ?? 2.0 };
    }
  }

  return compileScene({
    polygons,
    camera: buildCam(options.zoom),
    cols: options.cols,
    rows: options.rows,
    ...shared,
  });
}

/** Capture B5 controls using the same camera/grid/options as static compilation. */
export function buildCompileControlFrame(polygons: Polygon[], options: CompileFileOptions): GlyphControlFrame {
  if (options.autoFit) throw new TypeError("glyphcss: control capture requires explicit cols/rows; autoFit changes the output grid.");
  if (options.autoCenter) throw new TypeError("glyphcss: labeled control capture requires post-center geometry in its sidecar; autoCenter is not implicit.");
  const labels = options.labelSidecar ? verifyGlyphLabelSidecar(polygons, options.labelSidecar) : undefined;
  const scene = labels?.sceneManifest ?? options.sceneManifest;
  const dictionary = labels?.dictionary ?? options.dictionary;
  if (!scene || !dictionary) throw new TypeError("glyphcss: control capture requires a verified label sidecar.");
  if (!labels) verifyGlyphLabelSidecar(polygons, { schemaVersion: "glyph-label-sidecar/v1", scene, dictionary });
  const camera = options.projection === "orthographic"
    ? createGlyphOrthographicCamera({ rotX: options.rotX, rotY: options.rotY, zoom: options.zoom })
    : createGlyphPerspectiveCamera({ rotX: options.rotX, rotY: options.rotY, zoom: options.zoom, distance: options.distance, perspective: options.perspective });
  return buildGlyphControlFrame({
    polygons,
    scene,
    dictionary,
    camera,
    grid: { cols: options.cols ?? 80, rows: options.rows ?? 24, cellAspect: options.cellAspect ?? 2 },
    mode: options.mode,
    glyphPalette: options.glyphPalette,
    smoothShading: options.smoothShading,
    creaseAngle: options.creaseAngle,
    doubleSided: options.doubleSided,
    supersample: options.supersample,
  });
}

export async function buildCompileControlFrameFromFile(path: string, options: CompileFileOptions): Promise<GlyphControlFrame> {
  const { polygons } = await loadMeshFromFile(path, { meshResolution: options.meshResolution, mtlUrl: options.mtlUrl });
  return buildCompileControlFrame(polygons, options);
}

export async function compileFile(path: string, options: CompileFileOptions = {}): Promise<CompileSceneResult> {
  const { polygons } = await loadMeshFromFile(path, { meshResolution: options.meshResolution, mtlUrl: options.mtlUrl });
  return compilePolygons(polygons, options);
}
