import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { resolveGeometry } from "@glyphcss/core";
import type { Polygon } from "@glyphcss/core";
import { buildCellGrid } from "glyphcss";
import { loadMeshFromFile } from "./loadMeshFromFile";
import { compileFile, compilePolygons, cropCellGrid } from "./compileFile";
import { glyphcssCompile } from "./vite";

// Resolve from cwd (the package dir under vitest) — env-agnostic, unlike
// import.meta.url which happy-dom rewrites to a non-file:// URL.
const DOG = resolve(process.cwd(), "../../website/public/gallery/glb/Dog.glb");

describe("@glyphcss/compile", () => {
  it("loadMeshFromFile parses a .glb from disk", async () => {
    const result = await loadMeshFromFile(DOG);
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("compileFile produces a non-empty <pre> with content", async () => {
    const r = await compileFile(DOG, { autoCenter: true, rotX: 60, rotY: 45, zoom: 25, cols: 80, rows: 30 });
    expect(r.html.startsWith('<pre class="glyph-output">')).toBe(true);
    expect(r.html.endsWith("</pre>")).toBe(true);
    expect(r.cols).toBe(80);
    expect(r.rows).toBe(30);
    // Actual rendered glyphs (not just whitespace).
    expect(r.inner.replace(/<[^>]*>/g, "").replace(/\s/g, "").length).toBeGreaterThan(100);
  });

  it("compileFile honors --no-colors (plain escaped text, no spans)", async () => {
    const r = await compileFile(DOG, { autoCenter: true, useColors: false, cols: 40, rows: 16 });
    expect(r.inner.includes("<span")).toBe(false);
  });

  it("vite plugin compiles a mesh import with ?glyph", async () => {
    const plugin = glyphcssCompile();
    const id = `${DOG}?glyph&autoCenter=1&rotX=60&rotY=45&zoom=25&cols=60&rows=24`;
    const code = await (plugin.load as (id: string) => Promise<string | null>)(id);
    expect(code).toBeTruthy();
    expect(code).toContain("export default");
    expect(code).toContain("glyph-output");
    expect(code).toContain("export const meta");
  });

  it("vite plugin ignores non-glyph mesh imports", async () => {
    const plugin = glyphcssCompile();
    const out = await (plugin.load as (id: string) => Promise<string | null>)(`${DOG}?url`);
    expect(out).toBeNull();
  });
});

describe("@glyphcss/compile — autoFit", () => {
  it("sizes the grid to the content (cropped tight) without cols/rows", async () => {
    const r = await compileFile(DOG, { autoFit: { target: 40, by: "cols" }, autoCenter: true, rotX: 72, rotY: 28 });
    expect(r.cols).toBeGreaterThan(0);
    expect(r.cols).toBeLessThanOrEqual(60);      // ~target, cropped (not the padded grid)
    expect(r.rows).toBeGreaterThan(0);
    // no leading empty column across the whole block (cropped left)
    const lines = r.inner.split("\n");
    const minLead = Math.min(...lines.filter((l) => l.replace(/<[^>]*>/g, "").trim()).map((l) => {
      const t = l.replace(/<[^>]*>/g, ""); return t.length - t.replace(/^ +/, "").length;
    }));
    expect(minLead).toBe(0);
  });

  it("loads OBJ material + bakes texture colors (no palette-blue fallback)", async () => {
    const EXT = resolve(process.cwd(), "../../website/public/gallery/obj/opengameart/fire-extinguisher/extinguisher.obj");
    const r = await loadMeshFromFile(EXT);
    const colors = new Set(r.polygons.map((p) => p.color).filter(Boolean) as string[]);
    expect(colors.size).toBeGreaterThan(10);     // sampled from the texture → many colors
    expect(colors.has("#3b82f6")).toBe(false);   // not parseObj's palette fallback
    const reddish = [...colors].some((c) => {
      const rr = parseInt(c.slice(1, 3), 16), bb = parseInt(c.slice(5, 7), 16);
      return rr > 120 && rr > bb + 40;            // extinguisher body red
    });
    expect(reddish).toBe(true);
  });

  it("fits by rows — cols adapt to show the whole model", async () => {
    const r = await compileFile(DOG, { autoFit: { target: 24, by: "rows" }, autoCenter: true, rotX: 72, rotY: 28 });
    expect(r.rows).toBeGreaterThan(0);
    expect(r.rows).toBeLessThanOrEqual(40);   // ~24 rows, cropped (not the padded grid)
    expect(r.cols).toBeGreaterThan(0);        // width adapted to content
  });
});

describe("@glyphcss/compile — geometry input", () => {
  it("compilePolygons renders a primitive shape (cube)", () => {
    const r = compilePolygons(resolveGeometry("cube", { size: 1 }), {
      autoFit: { target: 30, by: "cols" }, autoCenter: true, rotX: 60, rotY: 35,
    });
    const glyphs = r.inner.replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
    expect(glyphs).toBeGreaterThan(20);
    expect(r.cols).toBeGreaterThan(0);
    expect(r.cols).toBeLessThanOrEqual(45);
  });

  it("compilePolygons renders custom polygons", () => {
    const tri: Polygon[] = [{ vertices: [[0, 0, 0], [2, 0, 0], [1, 2, 0]], color: "#ff0000" }];
    const r = compilePolygons(tri, { cols: 20, rows: 10, autoCenter: true });
    expect(r.inner.replace(/<[^>]*>/g, "").replace(/\s/g, "").length).toBeGreaterThan(0);
    expect(r.html).toContain("glyph-output");
  });
});

describe("@glyphcss/compile — cropCellGrid (P2-4 fix round 1, occluded fix round 2)", () => {
  // 6x4 grid, content occupies rows 1-2 / cols 1-4 (a 4x2 bounding box) so the
  // crop must trim a real border on every side, not just one.
  const cols = 6, rows = 4;
  const n = cols * rows;
  const char = new Array<string>(n).fill(" ");
  const color = new Array<string | null>(n).fill(null);
  const depth = new Float64Array(n);
  const worldPosition = new Float32Array(n * 3);
  const surfaceUv = new Float32Array(n * 2);
  const winnerMesh = new Int32Array(n);
  const occluded = new Uint8Array(n);
  const contentCols = [1, 2, 3, 4];
  const contentRows = [1, 2];
  for (const r of contentRows) {
    for (const c of contentCols) {
      const i = r * cols + c;
      char[i] = "#";
      color[i] = "#336699";
    }
  }
  // Every buffer gets a distinct, position-derived value at EVERY cell (not
  // just the painted ones) so a wrong window offset is caught even where
  // char/color alone wouldn't show it.
  for (let i = 0; i < n; i++) {
    depth[i] = i * 1.5 + 0.25;
    worldPosition[i * 3] = i; worldPosition[i * 3 + 1] = i + 100; worldPosition[i * 3 + 2] = i + 200;
    surfaceUv[i * 2] = i / n; surfaceUv[i * 2 + 1] = 1 - i / n;
    winnerMesh[i] = i + 7;
    occluded[i] = i % 2; // alternating 0/1 — not just all-zero, which a dropped buffer could fake via absence.
  }
  const full = buildCellGrid(char, color, depth, cols, rows, surfaceUv, null, worldPosition, null, null, null, null, null, null, null, winnerMesh, null);
  // `buildCellGrid` has no `occludedSrc` constructor argument (it is
  // written post-construction — see `cells.ts`'s `cloneCellGrid`), so it is
  // attached here directly, exactly as a real rasterize pass attaches it.
  full.occluded = occluded;

  it("crops every buffer to the same content window, not just char/color", () => {
    const cropped = cropCellGrid(full)!;
    expect(cropped).not.toBeNull();
    expect(cropped.cols).toBe(contentCols.length);
    expect(cropped.rows).toBe(contentRows.length);
    for (let r = 0; r < contentRows.length; r++) {
      for (let c = 0; c < contentCols.length; c++) {
        const srcIdx = (contentRows[r]! ) * cols + contentCols[c]!;
        const dstIdx = r * contentCols.length + c;
        // char/color: the window this test already exercised before the fix.
        expect(cropped.char[dstIdx]).toBe(full.char[srcIdx]);
        expect(cropped.color[dstIdx]).toBe(full.color[srcIdx]);
        // depth: dropped entirely pre-fix (rebuilt with depthSrc: null).
        expect(cropped.depth[dstIdx]).toBe(full.depth[srcIdx]);
        // optional buffers: omitted entirely pre-fix.
        expect(cropped.worldPosition![dstIdx * 3]).toBe(full.worldPosition![srcIdx * 3]);
        expect(cropped.worldPosition![dstIdx * 3 + 1]).toBe(full.worldPosition![srcIdx * 3 + 1]);
        expect(cropped.worldPosition![dstIdx * 3 + 2]).toBe(full.worldPosition![srcIdx * 3 + 2]);
        expect(cropped.surfaceUv![dstIdx * 2]).toBe(full.surfaceUv![srcIdx * 2]);
        expect(cropped.surfaceUv![dstIdx * 2 + 1]).toBe(full.surfaceUv![srcIdx * 2 + 1]);
        expect(cropped.winnerMesh![dstIdx]).toBe(full.winnerMesh![srcIdx]);
        // occluded (P2, F5b fix round 2): durable grid state written
        // post-construction (`cells.ts`'s `cloneCellGrid` does the same), so
        // it is not one of `buildCellGrid`'s own constructor arguments and
        // the crop has to carry it across by hand.
        expect(cropped.occluded![dstIdx]).toBe(full.occluded![srcIdx]);
      }
    }
    // Screen coordinates stay consistent with the CROPPED dimensions (freshly
    // derived, never the uncropped grid's own screenX/screenY).
    expect(Math.max(...cropped.screenX)).toBe(contentCols.length - 1);
    expect(Math.max(...cropped.screenY)).toBe(contentRows.length - 1);
    // A buffer the source grid never carried (shade, normal, ...) stays absent
    // rather than being manufactured.
    expect(cropped.shade).toBeUndefined();
    expect(cropped.normal).toBeUndefined();
  });

  it("null in, null out — the honest contract for a grid-less render (halfblock/quadrant)", () => {
    expect(cropCellGrid(null)).toBeNull();
  });

  it("an all-whitespace grid returns unchanged (matches cropLines' own early return)", () => {
    const blankChar = new Array<string>(n).fill(" ");
    const blank = buildCellGrid(blankChar, new Array<string | null>(n).fill(null), depth, cols, rows);
    expect(cropCellGrid(blank)).toBe(blank);
  });

  it("compilePolygons autoFit's real cropped grid carries real, non-degenerate depth", async () => {
    // End-to-end: the actual autoFit call path (not the synthetic grid above)
    // still produces a grid whose depth varies across the painted cells —
    // reverting cropCellGrid to pass `depthSrc: null` collapses every painted
    // cell to a single default (0), which this catches.
    const r = compilePolygons(resolveGeometry("cube", { size: 1 }), {
      autoFit: { target: 30, by: "cols" }, autoCenter: true, rotX: 60, rotY: 35,
    });
    expect(r.grid).not.toBeNull();
    const g = r.grid!;
    expect(g.cols).toBe(r.cols);
    expect(g.rows).toBe(r.rows);
    const paintedDepths = new Set<number>();
    for (let i = 0; i < g.char.length; i++) {
      if (g.char[i] !== " ") paintedDepths.add(g.depth[i]!);
    }
    expect(paintedDepths.size).toBeGreaterThan(1);
  });
});
