/**
 * SPIKE for research/contour-first-text/subpaths/06-measured-glyph-atlas-matching.md.
 *
 * Compares ink mode's default tangent-bucket glyph pick
 * (`inkGlyphForTangent` in packages/glyphcss/src/render/rasterize.ts) against
 * an internal-only measured-atlas argmin match, read off
 * `globalThis.__inkAtlasMatch` (`InkAtlasMatchConfig`, same
 * globalThis-flag precedent as `__glyphPerfDetail`). Nothing here is a public
 * API — this file is the only caller of that internal hook.
 *
 * NOT run by `pnpm test` — it is copied into `packages/effects/src/` as
 * `__spike_inkAtlas.test.ts` for execution only (needs that package's vitest
 * aliases for `glyphcss` -> source, plus its `@napi-rs/canvas` devDependency)
 * and removed afterward. This file is the checked-in, canonical copy.
 *
 * Run (from repo root):
 *   cp research/contour-first-text/experiments/06-ink-atlas-match.spike.ts \
 *      packages/effects/src/__spike_inkAtlas.test.ts
 *   pnpm --filter @glyphcss/effects exec vitest run src/__spike_inkAtlas.test.ts
 *   rm packages/effects/src/__spike_inkAtlas.test.ts
 */
import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createCanvas } from "@napi-rs/canvas";
import {
  rasterize,
  buildRasterizeContext,
  createGlyphOrthographicCamera,
  cubePolygons,
  spherePolygons,
} from "glyphcss";
import { measureGlyphSubcellMask } from "./calibrateRamp";
// Relative source import (not a workspace dependency of @glyphcss/effects) —
// spike-only, resolved because vitest transpiles TS on the fly.
import { parseFont } from "../../fonts/src/parseFont";
import { composeText } from "../../fonts/src/composeText";
import type { Polygon } from "@glyphcss/core";

// Local mirror of the internal-only `InkAtlasMatchConfig` shape in
// packages/glyphcss/src/render/rasterize.ts (not exported — this spike is a
// consumer via `globalThis`, not an importer of internal types).
interface InkAtlasMatchConfig {
  atlas: Map<string, Uint8Array>;
  subCols: number;
  subRows: number;
  metric?: "hamming" | "chamfer";
}

declare global {
  // eslint-disable-next-line no-var
  var __inkAtlasMatch: InkAtlasMatchConfig | undefined;
}

// Stroke-shaped candidate pool: ink strokes are thin lines/curves, so this
// leans on punctuation/line glyphs rather than `calibrateRamp`'s dense
// solid-mode fill pool.
const CANDIDATES = Array.from(new Set(
  " .'`,:;-_~^\"|\\/!ilI1()[]{}<>*+".split(""),
));

// Narrower, deliberately LINE-FORMING pool (no isolated dots/marks) — tests
// whether the punctuation pool's noise above is a candidate-set problem
// rather than a fundamental problem with per-cell argmin matching.
const LINE_CANDIDATES = Array.from(new Set(
  " .-_‾|\\/˙˸".split(""),
));

function buildAtlasFrom(glyphs: string[], subCols: number, subRows: number): Map<string, Uint8Array> {
  const atlas = new Map<string, Uint8Array>();
  const font = { family: "monospace", size: 32 };
  for (const glyph of glyphs) {
    atlas.set(glyph, measureGlyphSubcellMask(glyph, {
      font,
      canvasFactory: (w, h) => createCanvas(w, h) as never,
      subCols,
      subRows,
    }));
  }
  return atlas;
}

function buildAtlas(subCols: number, subRows: number): Map<string, Uint8Array> {
  return buildAtlasFrom(CANDIDATES, subCols, subRows);
}

function renderInk(polygons: Polygon[], opts: { cols: number; rows: number; rotX: number; rotY: number; zoom: number }): string {
  const camera = createGlyphOrthographicCamera({ rotX: opts.rotX, rotY: opts.rotY, zoom: opts.zoom });
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: opts.cols, rows: opts.rows, cellAspect: 2.0 },
    polygons,
    mode: "ink",
    useColors: false,
  });
  return rasterize(ctx);
}

function timeIt(fn: () => void, iters: number): number {
  for (let i = 0; i < 3; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / iters;
}

function glyphHistogram(text: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const ch of text) {
    if (ch === "\n" || ch === " ") continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

describe("ink atlas-match spike", () => {
  it("renders before/after comparisons and timing", () => {
    const fixture = resolve(__dirname, "../../fonts/test/fixtures/Roboto-Bold.ttf");
    const fontBuf = readFileSync(fixture);
    const roboto = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer);
    const textPolys = composeText(roboto, "GLYPH", { size: 100, depth: 20, curveSteps: 3, simplify: 3 });

    const cubePolys = cubePolygons({ center: [0, 0, 0], size: 120 });
    const spherePolys = spherePolygons({ center: [0, 0, 0], size: 160, subdivisions: 3 });

    const cases = [
      { name: "text-headon", polygons: textPolys, cols: 140, rows: 50, rotX: 0, rotY: 0, zoom: 5.5 },
      { name: "text-3quarter", polygons: textPolys, cols: 140, rows: 50, rotX: 18, rotY: 32, zoom: 5.5 },
      { name: "sphere", polygons: spherePolys, cols: 60, rows: 30, rotX: 20, rotY: 30, zoom: 4.5 },
      { name: "cube", polygons: cubePolys, cols: 50, rows: 26, rotX: 28, rotY: 38, zoom: 4.2 },
    ];

    console.log("=".repeat(80));
    console.log("BEFORE (tangent-bucket, default path) vs AFTER (measured atlas argmin)");
    console.log("=".repeat(80));

    for (const res of [8, 4]) {
      console.log(`\n\n########## ATLAS RESOLUTION ${res}x${res} ##########`);
      const atlas = buildAtlas(res, res);

      for (const c of cases) {
        delete globalThis.__inkAtlasMatch;
        const before = renderInk(c.polygons, c);

        globalThis.__inkAtlasMatch = { atlas, subCols: res, subRows: res, metric: "hamming" };
        const afterHamming = renderInk(c.polygons, c);

        globalThis.__inkAtlasMatch = { atlas, subCols: res, subRows: res, metric: "chamfer" };
        const afterChamfer = renderInk(c.polygons, c);
        delete globalThis.__inkAtlasMatch;

        console.log(`\n---- case: ${c.name} (res ${res}x${res}) ----`);
        console.log("-- BEFORE (tangent bucket) --");
        console.log(before);
        console.log("-- AFTER (atlas, hamming) --");
        console.log(afterHamming);
        console.log("-- AFTER (atlas, chamfer) --");
        console.log(afterChamfer);

        console.log("glyph histogram BEFORE:", glyphHistogram(before));
        console.log("glyph histogram AFTER hamming:", glyphHistogram(afterHamming));
        console.log("glyph histogram AFTER chamfer:", glyphHistogram(afterChamfer));

        if (c.name === "text-headon" || c.name === "sphere") {
          const msBefore = timeIt(() => { delete globalThis.__inkAtlasMatch; renderInk(c.polygons, c); }, 30);
          const msHamming = timeIt(() => {
            globalThis.__inkAtlasMatch = { atlas, subCols: res, subRows: res, metric: "hamming" };
            renderInk(c.polygons, c);
          }, 30);
          const msChamfer = timeIt(() => {
            globalThis.__inkAtlasMatch = { atlas, subCols: res, subRows: res, metric: "chamfer" };
            renderInk(c.polygons, c);
          }, 30);
          delete globalThis.__inkAtlasMatch;
          console.log(`timing ms/render — before: ${msBefore.toFixed(3)}  atlas-hamming: ${msHamming.toFixed(3)}  atlas-chamfer: ${msChamfer.toFixed(3)}`);
        }
      }
    }
  });

  it("follow-up: does a LINE-ONLY candidate pool fix the noise?", () => {
    const fixture = resolve(__dirname, "../../fonts/test/fixtures/Roboto-Bold.ttf");
    const fontBuf = readFileSync(fixture);
    const roboto = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer);
    const textPolys = composeText(roboto, "GLYPH", { size: 100, depth: 20, curveSteps: 3, simplify: 3 });
    const spherePolys = spherePolygons({ center: [0, 0, 0], size: 160, subdivisions: 3 });

    const res = 8;
    const lineAtlas = buildAtlasFrom(LINE_CANDIDATES, res, res);
    console.log(`\n\n########## FOLLOW-UP: line-only atlas pool = ${JSON.stringify(LINE_CANDIDATES)} ##########`);

    for (const c of [
      { name: "text-headon", polygons: textPolys, cols: 140, rows: 50, rotX: 0, rotY: 0, zoom: 5.5 },
      { name: "sphere", polygons: spherePolys, cols: 60, rows: 30, rotX: 20, rotY: 30, zoom: 4.5 },
    ]) {
      delete globalThis.__inkAtlasMatch;
      const before = renderInk(c.polygons, c);
      globalThis.__inkAtlasMatch = { atlas: lineAtlas, subCols: res, subRows: res, metric: "hamming" };
      const afterLineHamming = renderInk(c.polygons, c);
      delete globalThis.__inkAtlasMatch;

      console.log(`\n---- follow-up case: ${c.name} ----`);
      console.log("-- BEFORE (tangent bucket) --");
      console.log(before);
      console.log("-- AFTER (line-only atlas, hamming) --");
      console.log(afterLineHamming);
      console.log("glyph histogram AFTER line-only:", glyphHistogram(afterLineHamming));
    }
  });
});
