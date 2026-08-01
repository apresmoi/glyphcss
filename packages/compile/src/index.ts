/**
 * @glyphcss/compile — compile 3D meshes to static glyphcss ASCII.
 *
 *   - `compileScene(opts)`   pure: polygons → `<pre>` (re-exported from glyphcss)
 *   - `loadMeshFromFile(p)`  Node: read + parse a mesh file
 *   - `compileFile(p, opts)` Node: load a file → compiled `<pre>` (static)
 *   - `compileInteractive`   Node: load → decimate → self-contained interactive snippet
 *   - `glyphcssCompile()`    Vite plugin (also at "@glyphcss/compile/vite")
 *   - CLI: `glyphcss-compile <file> …`
 */
export { compileScene } from "glyphcss";
export type { CompileSceneOptions, CompileSceneResult } from "glyphcss";

export { loadMeshFromFile } from "./loadMeshFromFile";
export type { LoadMeshFromFileOptions } from "./loadMeshFromFile";
export { buildNodeTextureSamplers, buildNodeTextureSamplerBundle, materializeNodeTextureUrls, releaseNodeTextureUrls } from "./textureBakeNode";
export type { GlyphNodeTextureSamplerBundle, GlyphNodeTextureSource } from "./textureBakeNode";
export { buildCompileControlFrame, buildCompileControlFrameFromFile, compileFile, compilePolygons } from "./compileFile";
export type { CompileFileOptions } from "./compileFile";

export { compileInteractive, toCodepenPrefill } from "./compileInteractive";
export type {
  CompileInteractiveOptions,
  CompileInteractiveResult,
  GlyphInteraction,
} from "./compileInteractive";

export { glyphcssCompile } from "./vite";
export type { GlyphCompileOptions } from "./vite";

export { packGlyphControlTensorForNode } from "./controlTensor";

export {
  GLYPH_CONTROL_APPEARANCE_EXPORT_VERSION,
  GLYPH_CONTROL_EXPORT_VERSION,
  writeGlyphControlMaps,
} from "./controlMaps";
export type {
  GlyphControlAppearanceRgbExport,
  GlyphControlExportFrame,
  GlyphControlExportOptions,
  GlyphControlExportResult,
  GlyphControlExportManifest,
  GlyphControlExportManifestV1,
  GlyphControlExportManifestV2,
} from "./controlMaps";
export { verifyGlyphLabelSidecar } from "./labelSidecar";
export type { GlyphLabelSidecar, GlyphPolygonRemap, GlyphVerifiedLabels } from "./labelSidecar";
