#!/usr/bin/env node
/**
 * glyphcss — compile a 3D mesh file to static ASCII from any pipeline.
 *
 *   glyphcss duck.glb --auto-center           # ANSI color in the terminal
 *   glyphcss duck.glb -f text                 # plain ASCII
 *   glyphcss duck.glb -f full -o duck.html    # HTML document
 *
 * Output `--format`: `ansi` (truecolor terminal), `text` (plain), `html` (a
 * `<pre>`), or `full` (HTML doc). Default picks by destination — terminal → ansi,
 * `-o` file → html, piped → text. With no `--cols`/`--rows` it auto-fits the grid
 * + zoom to the content (cropped tight). Other defaults match the library.
 */
import { writeFile, readFile } from "node:fs/promises";
import { buildCompileControlFrame, buildCompileControlFrameFromFile, compileFile, compilePolygons, type CompileFileOptions } from "./compileFile";
import { compileInteractive, type GlyphInteraction } from "./compileInteractive";
import { writeGlyphControlMaps } from "./controlMaps";
import { encodeGlyphAnsi } from "glyphcss";
import { resolveGeometry } from "@glyphcss/core";
import type { RenderMode, MeshResolution, Polygon, GlyphGeometryName, Vec3 } from "@glyphcss/core";
import type { GlyphControlTensorNormalization } from "glyphcss";
import type { GlyphLabelSidecar } from "./labelSidecar";

const MESH_EXT = /\.(obj|glb|gltf|vox|stl)$/i;

/** Normalize a polygons JSON payload (array or { polygons }) to Polygon[]. */
function normalizePolygons(data: unknown): Polygon[] {
  const arr = Array.isArray(data) ? data : (data as { polygons?: unknown })?.polygons;
  if (!Array.isArray(arr)) throw new Error("polygons JSON must be an array or { polygons: [...] }");
  return arr.map((p: { vertices?: Vec3[]; v?: Vec3[]; color?: string; c?: string }, i) => {
    const vertices = p.vertices ?? p.v;
    if (!Array.isArray(vertices) || vertices.length < 3) throw new Error(`polygon ${i}: needs vertices [[x,y,z], …] (>= 3)`);
    return { vertices, color: p.color ?? p.c } as Polygon;
  });
}

type OutputFormat = "text" | "ansi" | "html" | "full";

interface Parsed {
  file?: string;
  out?: string;
  format?: OutputFormat;
  fit?: number;
  shape?: string;
  polygonsFile?: string;
  polygonsJson?: string;
  interactive: boolean;
  interactions?: GlyphInteraction[];
  decimateGrid?: number;
  cdnVersion?: string;
  glyphLabels?: string;
  controlOut?: string;
  normalizationFile?: string;
  opts: CompileFileOptions;
}

function parseArgs(argv: string[]): Parsed {
  const opts: CompileFileOptions = {};
  let file: string | undefined;
  let out: string | undefined;
  let format: OutputFormat | undefined;
  let fit: number | undefined;
  let shape: string | undefined;
  let polygonsFile: string | undefined;
  let polygonsJson: string | undefined;
  let interactive = false;
  let interactions: GlyphInteraction[] | undefined;
  let decimateGrid: number | undefined;
  let cdnVersion: string | undefined;
  let glyphLabels: string | undefined;
  let controlOut: string | undefined;
  let normalizationFile: string | undefined;
  const num = (v: string | undefined): number | undefined => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : undefined;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string | undefined => argv[++i];
    switch (a) {
      case "--rot-x": opts.rotX = num(next()); break;
      case "--rot-y": opts.rotY = num(next()); break;
      case "--zoom": opts.zoom = num(next()); break;
      case "--distance": opts.distance = num(next()); break;
      case "--perspective": opts.perspective = num(next()); break;
      case "--cols": opts.cols = num(next()); break;
      case "--rows": opts.rows = num(next()); break;
      case "--cell-aspect": opts.cellAspect = num(next()); break;
      case "--crease-angle": opts.creaseAngle = num(next()); break;
      case "--supersample": opts.supersample = num(next()); break;
      case "--mode": opts.mode = next() as RenderMode; break;
      case "--palette": opts.glyphPalette = next(); break;
      case "--glyph-output": {
        const value = next();
        if (value !== "visible" && value !== "semantic") throw new Error('--glyph-output must be "visible" or "semantic"');
        opts.glyphOutput = value;
        break;
      }
      case "--glyph-labels": glyphLabels = next(); break;
      case "--control-out": controlOut = next(); break;
      case "--control-normalization": normalizationFile = next(); break;
      case "--mesh-resolution": opts.meshResolution = next() as MeshResolution; break;
      case "--mtl": opts.mtlUrl = next(); break;
      // Geometry input (instead of a mesh file).
      case "--shape": shape = next(); break;
      case "--polygons": polygonsFile = next(); break;
      case "--polygons-json": polygonsJson = next(); break;
      case "--ortho": opts.projection = "orthographic"; break;
      case "--auto-center": opts.autoCenter = true; break;
      case "--smooth": opts.smoothShading = true; break;
      case "--double-sided": opts.doubleSided = true; break;
      case "--fit": fit = num(next()); break;
      // Output format (+ back-compat aliases).
      case "-f": case "--format": format = next() as OutputFormat; break;
      case "--ansi": format = "ansi"; break;
      case "--no-colors": case "--text": format = "text"; break;
      case "--pre": case "--html": format = "html"; break;
      case "--full": format = "full"; break;
      case "--interactive": interactive = true; break;
      case "--interactions":
        interactive = true;
        interactions = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean) as GlyphInteraction[];
        break;
      case "--decimate-grid": decimateGrid = num(next()); break;
      case "--cdn-version": cdnVersion = next(); break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": file = undefined; return { file, out, format, fit, shape, polygonsFile, polygonsJson, interactive, interactions, decimateGrid, cdnVersion, glyphLabels, controlOut, normalizationFile, opts };
      default:
        if (!a.startsWith("-") && !file) file = a;
    }
  }
  return { file, out, format, fit, shape, polygonsFile, polygonsJson, interactive, interactions, decimateGrid, cdnVersion, glyphLabels, controlOut, normalizationFile, opts };
}

const HELP = `glyphcss <mesh-file | shape> [options]

  Input    a mesh file (.obj/.glb/.gltf/.vox/.stl), a primitive shape name
           (e.g. cube, sphere, icosahedron, torus, cone), or:
           --shape NAME   --polygons FILE.json   --polygons-json '[{"vertices":[...],"color":"#f00"}]'
  Camera   --rot-x N  --rot-y N  --zoom N  --distance N  --perspective N  --ortho
  Grid     --cols N  --rows N  --cell-aspect N   (omit cols/rows → auto-fit to content)
  Fit      --fit N   target width in columns for auto-fit (default: terminal width or 80)
  Render   --mode solid|wireframe|voxel|ink  --palette NAME  --no-colors  --smooth  --double-sided
  Mesh     --auto-center  --mtl FILE (OBJ material override)  --mesh-resolution lossy|lossless  --crease-angle N  --supersample N
  Labels   --glyph-output visible|semantic --glyph-labels LABELS.json (glyph-label-sidecar/v1)
           --control-out DIR --control-normalization NORMALIZATION.json
  Interact --interactive  --interactions orbit,zoom,pan,fpv  --decimate-grid N  --cdn-version V
  Output   -f, --format text|ansi|html|full     (default: terminal → ansi, file → html, pipe → text)
           -o, --out FILE
`;

function wrapHtml(inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>glyphcss</title>
<style>
  html,body{margin:0;background:#0b0d10;color:#e2e8f0}
  pre.glyph-output{margin:0;font:13px/1 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre}
</style></head>
<body>${inner}</body></html>`;
}

async function main(): Promise<void> {
  const { file, out, format: fmtArg, fit, shape, polygonsFile, polygonsJson, interactive, interactions, decimateGrid, cdnVersion, glyphLabels, controlOut, normalizationFile, opts } = parseArgs(process.argv.slice(2));
  // A bare positional with no mesh extension is treated as a shape name.
  const positionalShape = file && !MESH_EXT.test(file) ? file : undefined;
  const meshFile = file && MESH_EXT.test(file) ? file : undefined;
  const shapeName = shape ?? positionalShape;
  if (!meshFile && !shapeName && !polygonsFile && !polygonsJson) {
    process.stderr.write(HELP);
    process.exit(process.argv.length <= 2 ? 1 : 0);
    return;
  }

  // Output format: explicit wins; else file → html, terminal → ansi, pipe → text.
  const format: OutputFormat = fmtArg ?? (out ? "html" : process.stdout.isTTY ? "ansi" : "text");
  if (glyphLabels) {
    const sidecar = JSON.parse(await readFile(glyphLabels, "utf8")) as GlyphLabelSidecar;
    if (sidecar.schemaVersion !== "glyph-label-sidecar/v1" || !sidecar.scene || !sidecar.dictionary) throw new Error("--glyph-labels must be a glyph-label-sidecar/v1 with scene and dictionary");
    opts.labelSidecar = sidecar;
  }
  if (opts.glyphOutput === "semantic" && !opts.labelSidecar) throw new Error("--glyph-output semantic requires --glyph-labels");
  if ((controlOut || normalizationFile) && (!controlOut || !normalizationFile || !opts.labelSidecar)) throw new Error("--control-out requires --control-normalization and --glyph-labels");

  if (interactive) {
    if (!meshFile) throw new Error("--interactive needs a mesh file (shapes/polygons are static-only for now)");
    const r = await compileInteractive(meshFile, { ...opts, interactions, decimateGrid, cdnVersion });
    const output = format === "full" ? wrapHtml(r.html) : r.html;
    if (out) {
      await writeFile(out, output, "utf8");
      process.stderr.write(`glyphcss: wrote ${out} — interactive [${r.interactions.join(", ")}], ${r.polygonCount}/${r.sourcePolygonCount} tris\n`);
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  // Colors are needed for every format except plain text.
  opts.useColors = format !== "text";

  // Auto-fit: with only one of --cols/--rows, fit that axis and let the other
  // adapt to show the whole model; with neither, fit width to the terminal.
  // Both given → fixed grid. --fit forces a width target.
  const hasCols = opts.cols !== undefined, hasRows = opts.rows !== undefined;
  const termW = process.stdout.columns ? process.stdout.columns - 1 : 80;
  if (fit !== undefined) opts.autoFit = { target: fit, by: "cols" };
  else if (hasCols && !hasRows) opts.autoFit = { target: opts.cols!, by: "cols" };
  else if (hasRows && !hasCols) opts.autoFit = { target: opts.rows!, by: "rows" };
  else if (!hasCols && !hasRows) opts.autoFit = { target: termW, by: "cols" };
  if (opts.autoFit) { opts.cols = undefined; opts.rows = undefined; }

  // Resolve the geometry source: inline polygons, polygons file, primitive shape,
  // or a mesh file.
  let result;
  let sourcePolygons: Polygon[] | undefined;
  if (polygonsJson) { sourcePolygons = normalizePolygons(JSON.parse(polygonsJson)); result = compilePolygons(sourcePolygons, opts); }
  else if (polygonsFile) { sourcePolygons = normalizePolygons(JSON.parse(await readFile(polygonsFile, "utf8"))); result = compilePolygons(sourcePolygons, opts); }
  else if (shapeName) { sourcePolygons = resolveGeometry(shapeName as GlyphGeometryName, { size: 1 }); result = compilePolygons(sourcePolygons, { ...opts, autoCenter: true }); }
  else result = await compileFile(meshFile!, opts);
  if (controlOut && normalizationFile) {
    const normalization = JSON.parse(await readFile(normalizationFile, "utf8")) as GlyphControlTensorNormalization;
    const frame = sourcePolygons
      ? buildCompileControlFrame(sourcePolygons, opts)
      : await buildCompileControlFrameFromFile(meshFile!, opts);
    await writeGlyphControlMaps({ destination: controlOut, frames: [{ frame }], normalization, glyphOutput: opts.glyphOutput });
  }
  const output =
    format === "text" ? result.inner :
    format === "ansi" ? encodeGlyphAnsi(result.inner) :
    format === "full" ? wrapHtml(result.html) :
    result.html;
  if (out) {
    await writeFile(out, output, "utf8");
    process.stderr.write(`glyphcss: wrote ${out} (${result.cols}×${result.rows}, ${format})\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`glyphcss: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
