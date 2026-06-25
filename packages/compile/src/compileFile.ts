/**
 * compileFile — load a mesh file and compile it to a static `<pre>`.
 *
 * Defaults mirror the glyphcss library exactly (perspective camera, cols 80 /
 * rows 24 / cellAspect 2.0, solid mode, colors on, etc.). Pass camera angle /
 * zoom / `autoCenter` to frame a model, or `autoFit` to size the grid + zoom to
 * the content automatically (handy for the terminal — no cols/rows needed).
 */
import {
  compileScene,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
  cropGlyphInner,
} from "glyphcss";
import type { CompileSceneResult, GlyphCamera } from "glyphcss";
import type { MeshResolution, RenderMode, Polygon } from "@glyphcss/core";
import { loadMeshFromFile } from "./loadMeshFromFile";

export interface CompileFileOptions {
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

export async function compileFile(path: string, options: CompileFileOptions = {}): Promise<CompileSceneResult> {
  const { polygons } = await loadMeshFromFile(path, { meshResolution: options.meshResolution, mtlUrl: options.mtlUrl });

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
