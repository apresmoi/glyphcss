// The CURRENT line strategies, driven through the real built packages
// (packages/*/dist) exactly the way the library feeds them — nothing here
// reimplements a glyph rule. Each adapter takes a test case (cell coords) and
// returns the emitted grid as [{ col, row, glyph }] for non-blank cells.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, withSeededRandom } from "./common.mjs";

const g = await import(pathToFileURL(path.join(ROOT, "packages/glyphcss/dist/index.js")).href);
const maps = await import(pathToFileURL(path.join(ROOT, "packages/maps/dist/index.js")).href);

function emptyCellGrid(cols, rows) {
  const n = cols * rows;
  return g.buildCellGrid(new Array(n).fill(" "), new Array(n).fill(null), new Float64Array(n).fill(-Infinity), cols, rows);
}

function cellsOf(chars, cols) {
  const out = [];
  chars.forEach((ch, i) => { if (ch !== " " && ch !== "") out.push({ col: i % cols, row: Math.floor(i / cols), glyph: ch }); });
  return out;
}

/** Vertices of each polyline; a closed ring repeats its first vertex (how rings reach the stampers). */
function rings(c) {
  return c.polylines.map((p) => (p.closed ? [...p.pts, p.pts[0]] : p.pts));
}

// ── @glyphcss/maps: stampGlyphMapPolyline (the /maps line layer) ──────────
function mapsStroke(strategy) {
  return (c) => {
    const grid = emptyCellGrid(c.cols, c.rows);
    for (const pts of rings(c)) {
      const verts = pts.map(([col, row]) => ({ col, row, depth: 0 }));
      // widget.ts hands braille a frozen surface copy; mirror it.
      const surface = strategy === "braille" ? { ...grid, depth: grid.depth.slice() } : undefined;
      maps.stampGlyphMapPolyline(grid, verts, { ...(strategy ? { experimentalGlyphStrategy: strategy } : {}), ...(surface ? { surface } : {}) });
    }
    return cellsOf(grid.char, c.cols);
  };
}

// ── glyphcss cell canvas: canvas.line() (charts' line marks) ────────────────
// line() puts a cell's CENTRE on integer coordinates, so geometric (x, y)
// in [c, c+1) cell space is passed as (x − 0.5, y − 0.5).
function canvasLine(tier) {
  return (c, fm) => {
    const canvas = g.createGlyphCanvas({ cols: c.cols, rows: c.rows, cellAspect: fm.cellW / fm.cellH, tier });
    for (const pts of rings(c)) {
      for (let i = 1; i < pts.length; i++) {
        canvas.line({ x: pts[i - 1][0] - 0.5, y: pts[i - 1][1] - 0.5 }, { x: pts[i][0] - 0.5, y: pts[i][1] - 0.5 });
      }
    }
    return cellsOf(canvas.grid.char, c.cols);
  };
}

// ── glyphcss scene rasterizer (wireframe / ink modes) ─────────────────────
// Orthographic, rotX = rotY = 0, zoom 1, cellWidth = cellHeight = 1 world
// unit per cell: world [row, col, z] projects to (col, row) exactly
// (asserted below).
const camera = g.createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
const world = (col, row, z = 0) => [row, col, z];
{
  const grid = { cols: 10, rows: 10, cellAspect: 1, cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };
  const p = camera.project(world(3.25, 7.5, 0), 10, 10, 1, grid);
  if (Math.abs(p[0] - 3.25) > 1e-9 || Math.abs(p[1] - 7.5) > 1e-9) throw new Error(`camera mapping assumption broken: ${p}`);
}

function rasterizeCells(c, fm, opts) {
  const grid = { cols: c.cols, rows: c.rows, cellAspect: fm.cellH / fm.cellW, cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };
  let captured = null;
  const ctx = g.buildRasterizeContext({ camera, grid, useColors: false, captureCells: (cg) => { captured = cg.char.slice(); }, ...opts });
  withSeededRandom(12345, () => g.rasterize(ctx));
  if (!captured) throw new Error("captureCells did not fire");
  return cellsOf(captured, c.cols);
}

function wireframe(extra) {
  return (c, fm) => {
    const edges = [];
    for (const pts of rings(c)) for (let i = 1; i < pts.length; i++) edges.push({ from: world(...pts[i - 1]), to: world(...pts[i]) });
    return rasterizeCells(c, fm, { mode: "wireframe", polygons: [], wireframe: edges, ...extra });
  };
}

// Ink mode outlines MESHES, so the line becomes a thin wall ("fin") extruded
// along view depth: seen head-on its two long boundary chains project onto
// the curve itself — the extruded-outline case ink mode exists for. The
// nearer chain wins every contested cell (equal rank → nearer depth).
function inkFin(c, fm) {
  const polygons = [];
  for (const pts of rings(c)) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      polygons.push({ vertices: [world(a[0], a[1], 0), world(b[0], b[1], 0), world(b[0], b[1], -1), world(a[0], a[1], -1)] });
    }
  }
  return rasterizeCells(c, fm, { mode: "ink", polygons });
}

/**
 * Strategy registry. `face` = the face the site draws this strategy in by
 * default; `vocab` = which glyph family its oracle comparison is restricted to.
 */
export const STRATEGIES = {
  "maps-ink": { run: mapsStroke(undefined), face: "atlas", vocab: "ink", where: "@glyphcss/maps line, no experimentalGlyphStrategy (inkGlyphForTangent per sample)" },
  "maps-box": { run: mapsStroke("box"), face: "atlas", vocab: "box", where: "@glyphcss/maps line, experimentalGlyphStrategy \"box\" (/maps?lines=box)" },
  "maps-braille": { run: mapsStroke("braille"), face: "atlas", vocab: "braille", where: "@glyphcss/maps line, experimentalGlyphStrategy \"braille\" (/maps default)" },
  "scene-ink": { run: inkFin, face: "atlas", vocab: "ink", where: "rasterize mode \"ink\" on a head-on fin mesh (tangent smoothing + inkGlyphForTangent)" },
  "wire-default": { run: wireframe({}), face: "atlas", vocab: "wire", where: "rasterize mode \"wireframe\", default palette, weight 2 (random tier glyph, seeded)" },
  "wire-junctions": { run: wireframe({ wireframeJunctions: true }), face: "atlas", vocab: "box", where: "wireframe + wireframeJunctions (JUNCTION_GLYPHS on near-axis edges)" },
  "wire-braille": { run: wireframe({ charMode: "braille" }), face: "atlas", vocab: "braille", where: "wireframe charMode \"braille\" (sub-cell dot raster)" },
  "canvas-box": { run: canvasLine("box"), face: "mono", vocab: "ink", where: "createGlyphCanvas tier \"box\" canvas.line() (charts/diagrams line)" },
  "canvas-braille": { run: canvasLine("braille"), face: "mono", vocab: "braille", where: "createGlyphCanvas tier \"braille\" canvas.line() (charts data lines)" },
};

/** Every glyph a current strategy can emit (for the candidate set). */
export function strategyGlyphs() {
  const set = new Set();
  // inkGlyphForTangent's whole output range.
  for (let a = 0; a < 180; a += 0.5) for (const s of [0.05, 0.2, 0.5, 0.9]) {
    const r = (a * Math.PI) / 180;
    set.add(g.inkGlyphForTangent(Math.cos(r), Math.sin(r), s, s));
  }
  set.add(g.inkGlyphForTangent(0, 0));
  for (const tier of ["thin", "normal", "core"]) for (const x of g.WIREFRAME_PALETTES.default[tier]) set.add(x);
  for (const x of "─│└┘┌┐├┤┬┴┼·") set.add(x); // box strategy + JUNCTION_GLYPHS
  for (const x of Object.values(g.GLYPH_CANVAS_TIERS.box.straight)) set.add(x);
  for (const x of Object.values(g.GLYPH_CANVAS_TIERS.box.diagonal)) set.add(x);
  for (let m = 0; m < 256; m++) set.add(String.fromCodePoint(0x2800 + m));
  for (const x of "‾-_|+`',.") set.add(x); // maps "ascii" experimental strategy
  set.delete(" ");
  return [...set];
}
