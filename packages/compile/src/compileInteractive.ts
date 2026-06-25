/**
 * compileInteractive — load a mesh file and compile it to a **self-contained
 * interactive** scene, shipping only what the declared interactions need.
 *
 * Thin Node wrapper: read the file, then hand the polygons to glyphcss's
 * (pure, browser-safe) `buildGlyphInteractiveExport`. The same builder powers
 * the in-browser "export to CodePen" button, so file pipeline and gallery emit
 * identical snippets.
 */
import {
  buildGlyphInteractiveExport,
  glyphCodepenPrefill,
} from "glyphcss";
import type {
  GlyphInteraction,
  GlyphInteractiveExportOptions,
  GlyphInteractiveExportResult,
} from "glyphcss";
import type { MeshResolution } from "@glyphcss/core";
import { loadMeshFromFile } from "./loadMeshFromFile";

export type { GlyphInteraction };
export type CompileInteractiveResult = GlyphInteractiveExportResult;
export interface CompileInteractiveOptions extends GlyphInteractiveExportOptions {
  /** Mesh-optimization quality passed to `loadMesh`. Default: the loadMesh default ("lossy"). */
  meshResolution?: MeshResolution;
  /** Explicit companion `.mtl` path for OBJ (overrides sibling auto-detection). */
  mtlUrl?: string;
}

/** Re-export for parity with the in-browser export button. */
export { glyphCodepenPrefill as toCodepenPrefill };

export async function compileInteractive(
  path: string,
  options: CompileInteractiveOptions = {},
): Promise<CompileInteractiveResult> {
  const { polygons } = await loadMeshFromFile(path, { meshResolution: options.meshResolution, mtlUrl: options.mtlUrl });
  return buildGlyphInteractiveExport(polygons, options);
}
