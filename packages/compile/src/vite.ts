/**
 * glyphcssCompile — a Vite plugin that compiles a mesh import to its static
 * `<pre>` ASCII **at build time**:
 *
 *   import duck from "./duck.glb?glyph&rotX=60&rotY=45&autoCenter=1";
 *   el.innerHTML = duck;          // the <pre>…ascii…</pre> string, zero runtime
 *
 * Query params map to `CompileFileOptions` (rotX, rotY, zoom, distance,
 * perspective, cols, rows, cellAspect, mode, palette, colors=0|1, autoCenter,
 * projection, meshResolution). Works in any Vite-based pipeline (Astro, vanilla
 * Vite, Vite-React). Defaults match the glyphcss library.
 */
import { buildCompileControlFrameFromFile, compileFile, type CompileFileOptions } from "./compileFile";
import { writeGlyphControlMaps } from "./controlMaps";
import type { RenderMode, MeshResolution } from "@glyphcss/core";
import { readFile } from "node:fs/promises";
import type { GlyphLabelSidecar } from "./labelSidecar";
import type { GlyphControlTensorNormalization } from "glyphcss";

// Structural Vite-plugin type — avoids a hard dependency on `vite`.
export interface VitePluginLike {
  name: string;
  enforce?: "pre" | "post";
  load(this: unknown, id: string): Promise<string | null> | string | null;
}

export type GlyphCompileOptions = Partial<CompileFileOptions>;

const MESH_RE = /\.(glb|gltf|obj|vox|stl)(\?|$)/i;

function hasGlyphFlag(id: string): boolean {
  const q = id.split("?")[1];
  return q != null && new URLSearchParams(q).has("glyph");
}

function parseQuery(id: string): CompileFileOptions {
  const q = id.split("?")[1] ?? "";
  const p = new URLSearchParams(q);
  const num = (k: string): number | undefined => (p.has(k) ? Number(p.get(k)) : undefined);
  const out: CompileFileOptions = {};
  for (const k of ["rotX", "rotY", "zoom", "distance", "perspective", "cols", "rows", "cellAspect", "creaseAngle", "supersample"] as const) {
    const v = num(k);
    if (v !== undefined && Number.isFinite(v)) out[k] = v;
  }
  if (p.has("mode")) out.mode = p.get("mode") as RenderMode;
  if (p.has("glyphOutput")) {
    const value = p.get("glyphOutput");
    if (value !== "visible" && value !== "semantic") throw new TypeError('glyphcss: glyphOutput must be "visible" or "semantic".');
    out.glyphOutput = value;
  }
  if (p.has("palette")) out.glyphPalette = p.get("palette") ?? undefined;
  if (p.has("projection")) out.projection = (p.get("projection") === "orthographic" ? "orthographic" : "perspective");
  if (p.has("meshResolution")) out.meshResolution = p.get("meshResolution") as MeshResolution;
  // booleans: `colors=0` disables; `autoCenter` / `autoCenter=1` enables.
  if (p.has("colors")) out.useColors = p.get("colors") !== "0" && p.get("colors") !== "false";
  if (p.has("autoCenter")) out.autoCenter = p.get("autoCenter") !== "0" && p.get("autoCenter") !== "false";
  if (p.has("smoothShading")) out.smoothShading = p.get("smoothShading") !== "0" && p.get("smoothShading") !== "false";
  if (p.has("doubleSided")) out.doubleSided = p.get("doubleSided") !== "0" && p.get("doubleSided") !== "false";
  return out;
}

/** A source-controlled B6 sidecar contains exactly the immutable scene + dictionary labels. */
async function sidecarFor(id: string): Promise<Pick<CompileFileOptions, "labelSidecar">> {
  const p = new URLSearchParams(id.split("?")[1] ?? "");
  const path = p.get("glyphLabels");
  if (!path) return {};
  const raw = JSON.parse(await readFile(path, "utf8")) as GlyphLabelSidecar;
  if (raw.schemaVersion !== "glyph-label-sidecar/v1" || !raw.scene || !raw.dictionary) throw new TypeError("glyphcss: glyphLabels must be a glyph-label-sidecar/v1 with scene and dictionary.");
  return { labelSidecar: raw };
}

export function glyphcssCompile(globalOptions: GlyphCompileOptions = {}): VitePluginLike {
  return {
    name: "glyphcss-compile",
    enforce: "pre",
    async load(id: string): Promise<string | null> {
      if (!MESH_RE.test(id) || !hasGlyphFlag(id)) return null;
      const path = id.split("?")[0];
      const sidecar = await sidecarFor(id);
      const opts: CompileFileOptions = { ...globalOptions, ...parseQuery(id), ...sidecar };
      const result = await compileFile(path, opts);
      const query = new URLSearchParams(id.split("?")[1] ?? "");
      const controlOut = query.get("controlOut");
      const normalizationPath = query.get("controlNormalization");
      if (controlOut || normalizationPath) {
        if (!controlOut || !normalizationPath || !opts.labelSidecar) throw new TypeError("glyphcss: Vite controlOut requires controlNormalization and glyphLabels.");
        const normalization = JSON.parse(await readFile(normalizationPath, "utf8")) as GlyphControlTensorNormalization;
        const frame = await buildCompileControlFrameFromFile(path, opts);
        await writeGlyphControlMaps({ destination: controlOut, frames: [{ frame }], normalization, glyphOutput: opts.glyphOutput });
      }
      const meta = { cols: result.cols, rows: result.rows, cellAspect: result.cellAspect, glyphOutput: opts.glyphOutput ?? "visible" };
      const labels = sidecar.labelSidecar ? { schemaVersion: "glyph-label-sidecar/v1", scene: { id: sidecar.labelSidecar.scene.id, contentSha256: sidecar.labelSidecar.scene.contentSha256, geometrySha256: sidecar.labelSidecar.scene.geometrySha256, polygonOrderSha256: sidecar.labelSidecar.scene.polygonOrderSha256 }, dictionary: { id: sidecar.labelSidecar.dictionary.id, contentSha256: sidecar.labelSidecar.dictionary.contentSha256 } } : null;
      return [
        `export default ${JSON.stringify(result.html)};`,
        `export const inner = ${JSON.stringify(result.inner)};`,
        `export const meta = ${JSON.stringify(meta)};`,
        `export const labels = ${JSON.stringify(labels)};`,
      ].join("\n");
    },
  };
}

export default glyphcssCompile;
