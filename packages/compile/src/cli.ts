#!/usr/bin/env node
/**
 * glyphcss-compile — compile a 3D mesh file to static ASCII from any pipeline.
 *
 *   glyphcss-compile duck.glb --auto-center --rot-x 60 --rot-y 45   # raw ASCII
 *   glyphcss-compile duck.glb --full -o duck.html                  # HTML doc
 *
 * Prints RAW ASCII to stdout by default (terminal-friendly); `--pre` wraps it in
 * a `<pre>`, `--full` emits a full HTML document. With no `--cols`/`--rows` it
 * auto-fits the grid + zoom to the content (cropped tight). Defaults otherwise
 * match the glyphcss library.
 */
import { writeFile } from "node:fs/promises";
import { compileFile, type CompileFileOptions } from "./compileFile";
import { compileInteractive, type GlyphInteraction } from "./compileInteractive";
import type { RenderMode, MeshResolution } from "@glyphcss/core";

interface Parsed {
  file?: string;
  out?: string;
  full: boolean;
  pre: boolean;
  fit?: number;
  interactive: boolean;
  interactions?: GlyphInteraction[];
  decimateGrid?: number;
  cdnVersion?: string;
  opts: CompileFileOptions;
}

function parseArgs(argv: string[]): Parsed {
  const opts: CompileFileOptions = {};
  let file: string | undefined;
  let out: string | undefined;
  let full = false;
  let pre = false;
  let fit: number | undefined;
  let interactive = false;
  let interactions: GlyphInteraction[] | undefined;
  let decimateGrid: number | undefined;
  let cdnVersion: string | undefined;
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
      case "--fit": fit = num(next()); break;
      case "--pre": pre = true; break;
      case "--full": full = true; break;
      case "--interactive": interactive = true; break;
      case "--interactions":
        interactive = true;
        interactions = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean) as GlyphInteraction[];
        break;
      case "--decimate-grid": decimateGrid = num(next()); break;
      case "--cdn-version": cdnVersion = next(); break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": file = undefined; return { file, out, full, pre, fit, interactive, interactions, decimateGrid, cdnVersion, opts };
      default:
        if (!a.startsWith("-") && !file) file = a;
    }
  }
  return { file, out, full, pre, fit, interactive, interactions, decimateGrid, cdnVersion, opts };
}

const HELP = `glyphcss-compile <mesh-file> [options]

  Camera   --rot-x N  --rot-y N  --zoom N  --distance N  --perspective N  --ortho
  Grid     --cols N  --rows N  --cell-aspect N   (omit cols/rows → auto-fit to content)
  Fit      --fit N   target width in columns for auto-fit (default: terminal width or 80)
  Render   --mode solid|wireframe|voxel  --palette NAME  --no-colors  --smooth  --double-sided
  Mesh     --auto-center  --mesh-resolution lossy|lossless  --crease-angle N  --supersample N
  Interact --interactive  --interactions orbit,zoom,pan,fpv  --decimate-grid N  --cdn-version V
  Output   default: raw text   --pre (wrap in <pre>)   --full (HTML doc)   -o, --out FILE
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
  const { file, out, full, pre, fit, interactive, interactions, decimateGrid, cdnVersion, opts } = parseArgs(process.argv.slice(2));
  if (!file) {
    process.stderr.write(HELP);
    process.exit(process.argv.length <= 2 ? 1 : 0);
    return;
  }

  // Auto-fit: with only one of --cols/--rows, fit that axis and let the other
  // adapt to show the whole model; with neither, fit width to the terminal.
  // Both given → fixed grid. --fit forces a width target.
  if (!interactive) {
    const hasCols = opts.cols !== undefined, hasRows = opts.rows !== undefined;
    const termW = process.stdout.columns ? process.stdout.columns - 1 : 80;
    if (fit !== undefined) opts.autoFit = { target: fit, by: "cols" };
    else if (hasCols && !hasRows) opts.autoFit = { target: opts.cols!, by: "cols" };
    else if (hasRows && !hasCols) opts.autoFit = { target: opts.rows!, by: "rows" };
    else if (!hasCols && !hasRows) opts.autoFit = { target: termW, by: "cols" };
    if (opts.autoFit) { opts.cols = undefined; opts.rows = undefined; }
  }

  if (interactive) {
    const r = await compileInteractive(file, { ...opts, interactions, decimateGrid, cdnVersion });
    const output = full ? wrapHtml(r.html) : r.html;
    if (out) {
      await writeFile(out, output, "utf8");
      process.stderr.write(`glyphcss-compile: wrote ${out} — interactive [${r.interactions.join(", ")}], ${r.polygonCount}/${r.sourcePolygonCount} tris\n`);
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  const result = await compileFile(file, opts);
  // Default to raw text (terminal-friendly); --pre wraps in <pre>, --full a doc.
  const output = full ? wrapHtml(result.html) : pre ? result.html : result.inner;
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
