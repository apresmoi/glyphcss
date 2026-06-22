/**
 * compileFile — load a mesh file and compile it to a static `<pre>`.
 *
 * Defaults mirror the glyphcss library exactly (perspective camera, cols 80 /
 * rows 24 / cellAspect 2.0, solid mode, colors on, etc. — see `compileScene` /
 * `createGlyphScene`). Pass camera angle / zoom / `autoCenter` to frame a model;
 * with bare defaults you get the same render the runtime would produce for the
 * same inputs.
 */
import {
  compileScene,
  createGlyphPerspectiveCamera,
  createGlyphOrthographicCamera,
} from "glyphcss";
import type { CompileSceneResult } from "glyphcss";
import type { MeshResolution, RenderMode } from "@glyphcss/core";
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
  /** Mesh-optimization quality passed to `loadMesh`. Default: the loadMesh default ("lossy"). */
  meshResolution?: MeshResolution;
}

export async function compileFile(path: string, options: CompileFileOptions = {}): Promise<CompileSceneResult> {
  const { polygons } = await loadMeshFromFile(path, { meshResolution: options.meshResolution });

  const camera = options.projection === "orthographic"
    ? createGlyphOrthographicCamera({ rotX: options.rotX, rotY: options.rotY, zoom: options.zoom })
    : createGlyphPerspectiveCamera({
        rotX: options.rotX,
        rotY: options.rotY,
        zoom: options.zoom,
        distance: options.distance,
        perspective: options.perspective,
      });

  return compileScene({
    polygons,
    camera,
    autoCenter: options.autoCenter,
    cols: options.cols,
    rows: options.rows,
    cellAspect: options.cellAspect,
    mode: options.mode,
    glyphPalette: options.glyphPalette,
    useColors: options.useColors,
    smoothShading: options.smoothShading,
    creaseAngle: options.creaseAngle,
    doubleSided: options.doubleSided,
    supersample: options.supersample,
  });
}
