/**
 * Unit gate for `point.ts` — the disc-to-cells rule a stamped point layer's
 * SIZE is expressed through.
 *
 * The property under test is the one the user asked for in the words "the
 * satellites are super tiny... maybe we can make them bigger": a magnitude
 * has to read as a SIZE on a character grid, where the smallest paintable
 * thing is one cell. There is exactly one rule for that here — rasterize the
 * disc, pick each cell's glyph by its own coverage — and this file pins both
 * halves of what that buys: under one cell the mark grows by climbing the
 * ramp, past one cell it grows by covering more cells.
 *
 * Kept out of `widget.*` deliberately: the widget tests measure the real
 * renderer, where a mark's cell count is also a function of the camera, the
 * projection and whatever terrain won the cell. Here the margins are exact.
 */
import { describe, expect, it } from "vitest";
import type { CellGrid } from "glyphcss";
import {
  glyphMapAsciiLabel,
  GLYPH_MAP_POINT_MAX_SIZE_ROWS,
  GLYPH_MAP_POINT_RAMP,
  glyphMapPointCells,
  stampGlyphMapPoint,
  stampGlyphMapPointLabel,
} from "./point";

const COLS = 40;
const ROWS = 20;
/** `/maps`' own cell shape: a cell is twice as tall as it is wide. */
const ASPECT = 2;

function makeGrid(depthAt: (col: number, row: number) => number): CellGrid {
  const n = COLS * ROWS;
  const depth = new Float64Array(n);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) depth[row * COLS + col] = depthAt(col, row);
  return {
    cols: COLS,
    rows: ROWS,
    char: new Array(n).fill(" "),
    color: new Array(n).fill(null),
    depth,
    screenX: new Int32Array(n),
    screenY: new Int32Array(n),
  };
}

const inked = (grid: CellGrid): number => grid.char.filter((c) => c !== " ").length;

describe("glyphMapPointCells — size is a glyph, then a footprint", () => {
  it("draws exactly one cell, at the ramp's LARGEST glyph, for size 0", () => {
    // The documented default, and the case a launch pad or a satellite is:
    // one crisp mark per feature, never two because the point happened to
    // straddle a column boundary.
    const cells = glyphMapPointCells(10.9, 5.1, 0, ASPECT);
    expect(cells).toEqual([{ col: 10, row: 5, glyph: GLYPH_MAP_POINT_RAMP[GLYPH_MAP_POINT_RAMP.length - 1], coverage: 1 }]);
  });

  it("climbs the ramp as the disc grows — the same shape, drawn bigger", () => {
    // Centred on a cell centre so the CENTRE cell's coverage is a pure
    // function of the radius: a disc of radius `r` rows is `2r` columns wide
    // at aspect 2, so while it fits inside the cell its coverage is `2*pi*r^2`.
    const centreGlyph = (size: number): string =>
      glyphMapPointCells(10.5, 5.5, size, ASPECT).find((c) => c.col === 10 && c.row === 5)!.glyph;
    expect(centreGlyph(0.15)).toBe(GLYPH_MAP_POINT_RAMP[0]); // 0.14 of the cell
    expect(centreGlyph(0.25)).toBe(GLYPH_MAP_POINT_RAMP[1]); // 0.39
    expect(centreGlyph(0.45)).toBe(GLYPH_MAP_POINT_RAMP[2]); // saturated

    // The first two steps are still ONE cell, which is what "smaller than a
    // cell" has to mean on a character grid; the top step is where the disc
    // starts spilling, because at aspect 2 a disc tall enough to fill a cell
    // vertically is already twice as wide as one.
    expect(glyphMapPointCells(10.5, 5.5, 0.15, ASPECT).length).toBe(1);
    expect(glyphMapPointCells(10.5, 5.5, 0.25, ASPECT).length).toBe(1);
  });

  it("grows a FOOTPRINT past one cell — and it is wider than it is tall, because a cell is not", () => {
    const cells = glyphMapPointCells(20.5, 10.5, 1, ASPECT);
    const cols = new Set(cells.map((c) => c.col));
    const rows = new Set(cells.map((c) => c.row));
    expect(cells.length).toBeGreaterThan(1);
    // A 1-row radius disc is 2 rows tall and, at aspect 2, 4 columns wide.
    // Without the aspect stretch this would be a vertical ellipse — the
    // whole reason `cellAspect` is an argument.
    expect(cols.size).toBeGreaterThan(rows.size);
  });

  it("is monotone: a bigger magnitude never draws fewer cells", () => {
    let previous = 0;
    for (const size of [0, 0.3, 0.6, 1, 1.5, 2, 3]) {
      const n = glyphMapPointCells(20.5, 10.5, size, ASPECT).length;
      expect(n, `size ${size}`).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
    // The premise: the range genuinely spans "one cell" to "many".
    expect(previous).toBeGreaterThan(20);
  });

  it("caps a runaway property at GLYPH_MAP_POINT_MAX_SIZE_ROWS rather than walking the viewport", () => {
    const capped = glyphMapPointCells(20.5, 10.5, GLYPH_MAP_POINT_MAX_SIZE_ROWS, ASPECT).length;
    expect(glyphMapPointCells(20.5, 10.5, 10_000, ASPECT).length).toBe(capped);
  });

  it("still draws a feature whose disc is smaller than the coverage floor", () => {
    // A layer's smallest class must be SMALL, never absent.
    const cells = glyphMapPointCells(10.5, 5.5, 0.01, ASPECT);
    expect(cells.length).toBe(1);
    expect(cells[0]!.glyph).toBe(GLYPH_MAP_POINT_RAMP[0]);
  });

  it("takes a one-entry ramp as a fixed mark the coverage rule cannot vary", () => {
    const cells = glyphMapPointCells(10.5, 5.5, 1, ASPECT, ["★"]);
    expect(new Set(cells.map((c) => c.glyph))).toEqual(new Set(["★"]));
  });
});

describe("stampGlyphMapPoint — the depth test is the stroke's own", () => {
  it("inks an empty grid — no surface there means nothing to be behind", () => {
    const grid = makeGrid(() => -Infinity);
    expect(stampGlyphMapPoint(grid, { col: 10.5, row: 5.5, depth: 0 }, { cellAspect: ASPECT })).toBe(1);
    expect(grid.char[5 * COLS + 10]).toBe(GLYPH_MAP_POINT_RAMP[2]);
  });

  it("is BLANKED by a surface nearer than it, and reports zero cells", () => {
    // `depth` is larger = nearer, so a surface at +10 stands in front of a
    // mark at 0. The return value is the visibility answer the widget keys
    // clickability and labelling on — it must be 0, not "drew invisibly".
    const grid = makeGrid(() => 10);
    expect(stampGlyphMapPoint(grid, { col: 10.5, row: 5.5, depth: 0, size: 1 }, { cellAspect: ASPECT })).toBe(0);
    expect(inked(grid)).toBe(0);
  });

  it("is blanked PER CELL, so a mark straddling a ridge loses only the half behind it", () => {
    // A wall down the middle of the mark: everything left of column 20 is in
    // front of it, everything right is behind. A per-MARK test would draw all
    // of it or none of it.
    const grid = makeGrid((col) => (col < 20 ? 10 : -10));
    const drawn = stampGlyphMapPoint(grid, { col: 20, row: 10, depth: 0, size: 2 }, { cellAspect: ASPECT });
    expect(drawn).toBeGreaterThan(0);
    const left = grid.char.filter((c, i) => c !== " " && i % COLS < 20).length;
    const right = grid.char.filter((c, i) => c !== " " && i % COLS >= 20).length;
    expect(left).toBe(0);
    expect(right).toBeGreaterThan(0);
  });

  it("skips a cell a DIFFERENT output layer owns", () => {
    // `CellGrid.occluded` is glyphcss's cross-`<pre>` ownership verdict; the
    // depth buffer cannot express it, because a mesh in its own `<pre>` is
    // simply absent from this grid's depth.
    const grid = makeGrid(() => -Infinity);
    grid.occluded = new Uint8Array(COLS * ROWS).fill(1);
    expect(stampGlyphMapPoint(grid, { col: 10.5, row: 5.5, depth: 0, size: 1 }, { cellAspect: ASPECT })).toBe(0);
  });
});

describe("stampGlyphMapPointLabel", () => {
  it("centres each line on the anchor column and leaves spaces transparent", () => {
    const grid = makeGrid(() => -Infinity);
    grid.char[10 * COLS + 20] = "#"; // terrain under the label's own space
    stampGlyphMapPointLabel(grid, ["a b"], 20.5, 10, 0);
    const row = Array.from({ length: COLS }, (_, c) => grid.char[10 * COLS + c]).join("");
    expect(row.slice(19, 22)).toBe("a#b");
  });
});

describe("glyphMapAsciiLabel — a stamped label cannot cost the scene its encoder", () => {
  it("folds every out-of-atlas character the vendored USGS week actually ships", () => {
    // Measured, not guessed: these are the nine characters that appear in
    // 385 real event titles and are absent from `GLYPH_FONT_ATLAS`.
    expect(glyphMapAsciiLabel("Nabatîyé et Tahta")).toBe("Nabatiye et Tahta");
    expect(glyphMapAsciiLabel("Kuril\u2019sk")).toBe("Kuril'sk");
    expect(glyphMapAsciiLabel("Tōkyō, Kahramanmaraş, Ancón, Öræfi")).toBe("Tokyo, Kahramanmaras, Ancon, Oraefi");
  });

  it("substitutes what NFD cannot decompose", () => {
    expect(glyphMapAsciiLabel("Tromsø — Gdańsk … Straße")).toBe("Tromso - Gdansk ... Strasse");
  });

  it("returns the ORIGINAL string for a label that is already printable ASCII", () => {
    // The common case must be byte-identical, or every label pays for this.
    const plain = "M 5.6 - 93 km SE of Kirakira, Solomon Islands";
    expect(glyphMapAsciiLabel(plain)).toBe(plain);
  });

  it("answers the empty string for a script this atlas cannot write, so the caller draws nothing", () => {
    expect(glyphMapAsciiLabel("\u6771\u4eac")).toBe("");
  });
});
