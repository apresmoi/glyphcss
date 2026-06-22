#!/usr/bin/env node
/**
 * glyphcss-compile — compile a 3D mesh file to static ASCII from any pipeline.
 *
 *   glyphcss-compile duck.glb --auto-center --rot-x 60 --rot-y 45 > duck.html
 *   glyphcss-compile duck.glb --full -o duck.html
 *
 * Prints the `<pre>` to stdout (or a full HTML document with `--full`).
 * Defaults match the glyphcss library; pass camera angle / zoom / --auto-center
 * to frame a model.
 */
import { writeFile } from "node:fs/promises";
import { compileFile, type CompileFileOptions } from "./compileFile";
import type { RenderMode, MeshResolution } from "@glyphcss/core";

interface Parsed {
  file?: string;
  out?: string;
  full: boolean;
  opts: CompileFileOptions;
}

function parseArgs(argv: string[]): Parsed {
  const opts: CompileFileOptions = {};
  let file: string | undefined;
  let out: string | undefined;
  let full = false;
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
      case "--mesh-resolution": opts.meshResolution = next() as MeshResolution; break;
      case "--ortho": opts.projection = "orthographic"; break;
      case "--auto-center": opts.autoCenter = true; break;
      case "--no-colors": opts.useColors = false; break;
      case "--smooth": opts.smoothShading = true; break;
      case "--double-sided": opts.doubleSided = true; break;
      case "--full": full = true; break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": file = undefined; return { file, out, full, opts };
      default:
        if (!a.startsWith("-") && !file) file = a;
    }
  }
  return { file, out, full, opts };
}

const HELP = `glyphcss-compile <mesh-file> [options]

  Camera   --rot-x N  --rot-y N  --zoom N  --distance N  --perspective N  --ortho
  Grid     --cols N  --rows N  --cell-aspect N
  Render   --mode solid|wireframe|voxel  --palette NAME  --no-colors  --smooth  --double-sided
  Mesh     --auto-center  --mesh-resolution lossy|lossless  --crease-angle N  --supersample N
  Output   --full (full HTML doc)   -o, --out FILE   (default: stdout)
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
  const { file, out, full, opts } = parseArgs(process.argv.slice(2));
  if (!file) {
    process.stderr.write(HELP);
    process.exit(file === undefined && process.argv.length <= 2 ? 1 : 0);
    return;
  }
  const result = await compileFile(file, opts);
  const output = full ? wrapHtml(result.html) : result.html;
  if (out) {
    await writeFile(out, output, "utf8");
    process.stderr.write(`glyphcss-compile: wrote ${out} (${result.cols}×${result.rows})\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`glyphcss-compile: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
