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
export { compileFile, compilePolygons } from "./compileFile";
export type { CompileFileOptions } from "./compileFile";

export { compileInteractive, toCodepenPrefill } from "./compileInteractive";
export type {
  CompileInteractiveOptions,
  CompileInteractiveResult,
  GlyphInteraction,
} from "./compileInteractive";

export { glyphcssCompile } from "./vite";
export type { GlyphCompileOptions } from "./vite";
