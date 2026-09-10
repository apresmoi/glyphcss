/**
 * `GlyphMapContourLayer`'s elevation WINDOW (`minElevation`/`maxElevation`).
 *
 * The problem: ETOPO1 spans roughly -10,900 m to +8,300 m, and `levels`
 * resolves against whatever range the mounted mosaic actually has — so a
 * count-based `levels` spends most of its lines on the abyssal plains and
 * leaves land with a handful. A floor and a ceiling fix that with two
 * numbers instead of a land/sea MODE, and do strictly more (`floor 0` =
 * land only, `ceiling 0` = sea only, `0..2000` = the foothills). It also
 * sidesteps defining "land" at all: the Caspian and the Dead Sea are below
 * the floor exactly like anywhere else.
 *
 * BOTH halves are asserted here, because either alone is a half-fix:
 *
 *  1. LEVELS ARE CHOSEN WITHIN THE WINDOW — a count spreads its lines over
 *     `0..max`, not over `dataMin..max`. That is the part that actually
 *     fixes the crowding.
 *  2. INK IS CLIPPED TO THE WINDOW — no cell whose own elevation is outside
 *     it may ink, even when a level legitimately crosses between it and a
 *     neighbour. A sea cliff is the case: one cell reads -5,000 m and the
 *     next +2,000 m, so a 1,000 m level crosses BETWEEN them and the
 *     crossing is detected on the OCEAN cell (the crossing scan reads a
 *     cell's right/down neighbours), inking a contour 5 km below the floor.
 *
 * FIXTURE NOTES.
 *  - No `raster` layer is mounted, so `requireSurface` degrades to false
 *    (widget.ts's `hasOpaqueSurface`) and the base grid stays BLANK — every
 *    non-space character in the output is contour ink, with no chance of a
 *    terrain ramp glyph colliding with an oriented-ink glyph.
 *  - Expectations are derived from the field as the widget itself samples it
 *    (`map.unproject` at each cell centre → `glyphMapFieldValueAt`), never
 *    from an assumed cell↔longitude alignment. What the test asserts on its
 *    own authority is WHICH LEVELS get chosen and WHICH CELLS may ink.
 *  - Elevation is constant down each column, so a level inks exactly one
 *    column (no vertical crossings) and an inked-COLUMN set is an exact
 *    fingerprint of the level list rather than a count of ink across rows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import { glyphMapFieldValueAt } from "./sample";
import type { GlyphMapField } from "./types";

const COLS = 60;
const ROWS = 24;
const SPAN = 40;

/**
 * A field whose elevation depends only on longitude: a flat ocean plateau at
 * `ocean` over the western half, then a one-cell CLIFF up to `landMin` and a
 * linear ramp east to `landMax`. The plateau is flat on purpose — a level
 * inside it would cross nowhere, so every inked column is attributable to
 * either the cliff or the land ramp.
 *
 * The field grid matches the view grid exactly (same bounds, same cols/rows),
 * so `glyphMapFieldValueAt`'s bilinear read at a cell centre is that cell's
 * own authored value up to at most a half-cell blend.
 */
function stepField(ocean: number, landMin: number, landMax: number): GlyphMapField {
  const values = new Float32Array(COLS * ROWS);
  const cliff = COLS / 2;
  for (let col = 0; col < COLS; col++) {
    const v = col < cliff ? ocean : landMin + (landMax - landMin) * ((col - cliff) / (COLS - 1 - cliff));
    for (let row = 0; row < ROWS; row++) values[row * COLS + col] = v;
  }
  return {
    bounds: { west: -SPAN / 2, east: SPAN / 2, south: -(SPAN * ROWS) / COLS / 2, north: (SPAN * ROWS) / COLS / 2 },
    cols: COLS,
    rows: ROWS,
    values,
    noData: new Uint8Array(COLS * ROWS),
    kind: "continuous",
    min: ocean,
    max: landMax,
  };
}

/**
 * The same profile mirrored east-west: land ramping DOWN from `landMax` to
 * `landMin` over the western half, then the ocean plateau.
 *
 * Orientation matters here and is not cosmetic. The crossing scan reads a
 * cell's RIGHT neighbour, so which side of a cliff detects a crossing
 * depends on which way the cliff faces: `stepField` puts the detecting cell
 * on the OCEAN side (what the ink gate must catch), and this puts it on the
 * LAND side — an IN-window cell inking because of an OUT-of-window level,
 * which only clipping the level LIST can catch.
 */
function mirroredStepField(ocean: number, landMin: number, landMax: number): GlyphMapField {
  const field = stepField(ocean, landMin, landMax);
  const values = new Float32Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) values[row * COLS + col] = field.values[row * COLS + (COLS - 1 - col)];
  }
  return { ...field, values };
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    // Straight top-down: relief affects depth only, never screen X/Y, so a
    // column stays a column.
    tilt: 0,
  });
  return { host, map };
}

/** Every (col,row) carrying a non-space glyph — with a blank base grid, exactly the contour's own ink. */
function inkedCells(map: ReturnType<typeof createGlyphMap>): { col: number; row: number }[] {
  const lines = (map.scene.output.textContent ?? "").split("\n");
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const ch = lines[row]?.[col] ?? " ";
      if (ch !== " " && ch !== "") out.push({ col, row });
    }
  }
  return out;
}

/** The elevation the WIDGET reads at each cell of `row`, through the same unproject → field sample path `stamp` uses. */
function sampledProfile(map: ReturnType<typeof createGlyphMap>, field: GlyphMapField, row: number): number[] {
  return Array.from({ length: COLS }, (_, col) => {
    const ll = map.unproject([col + 0.5, row + 0.5]);
    return ll ? glyphMapFieldValueAt(field, ll[0], ll[1]) : NaN;
  });
}

/**
 * The columns a given level list must ink, read off the widget's own sampled
 * profile.
 *
 * A contour is GEOMETRY now (`contourGeometry.ts`), so this is not a
 * per-cell crossing rule any more but the crossing's own POSITION: marching
 * squares cuts the isoline where the field reaches the level, between the two
 * sample points either side of it, and the ink lands in whichever output cell
 * that lon falls in. Here the field grid and the view grid are the same
 * `COLS x ROWS` over the same bounds, so sample `col` sits at screen position
 * `col + 0.5` and a crossing a fraction `t` of the way to its right neighbour
 * is at `col + 0.5 + t`.
 *
 * There is no `floor`/`ceiling` parameter any more, and that is the window's
 * per-cell ink gate being SUBSUMED rather than dropped: a marching vertex
 * stands AT its own level by construction, so a level inside the window can
 * no longer put ink on terrain kilometres outside it. What used to ink a
 * whole ocean cell because a level crossed somewhere between it and the land
 * cell beside it now inks at the point where that level actually is.
 */
function expectedColumns(profile: readonly number[], levels: readonly number[]): number[] {
  const cols = new Set<number>();
  for (let col = 0; col < COLS - 1; col++) {
    const e = profile[col];
    const right = profile[col + 1];
    if (!Number.isFinite(e) || !Number.isFinite(right) || e === right) continue;
    for (const level of levels) {
      if ((e - level) * (right - level) > 0) continue;
      cols.add(Math.floor(col + 0.5 + (level - e) / (right - e)));
    }
  }
  return [...cols].sort((a, b) => a - b);
}

const columnsOf = (cells: { col: number; row: number }[]): number[] => [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createGlyphMap — contour elevation window (minElevation/maxElevation)", () => {
  it("clips ink to the window: a sea cliff never inks a contour below the floor", () => {
    const { host, map } = mount();
    // Land starts at 2,000 m, so the 1,000 m level crosses ONLY inside the
    // cliff — and the crossing is detected on the ocean side of it.
    const field = stepField(-5000, 2000, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: [1000, 3000], minElevation: 0, color: "#00aaff" });
    map.scene.rerender();

    const profile = sampledProfile(map, field, 12);
    // The fixture must actually contain the trap, or this test proves
    // nothing: an in-window cell whose right neighbour is far above it, with
    // a level in between.
    const cliffCol = profile.findIndex((v, i) => Number.isFinite(v) && v < 0 && profile[i + 1] > 1000);
    expect(cliffCol).toBeGreaterThan(0);

    const cells = inkedCells(map);
    expect(cells.length).toBeGreaterThan(0); // the 3,000 m level still inks on land
    for (const { col, row } of cells) {
      const ll = map.unproject([col + 0.5, row + 0.5]);
      const elevation = ll ? glyphMapFieldValueAt(field, ll[0], ll[1]) : NaN;
      // Reported with the cell's own address so a failure names WHERE the
      // out-of-window ink landed, not just that some exists.
      expect({ col, row, belowFloor: !(elevation >= 0) }).toEqual({ col, row, belowFloor: false });
    }
    // And specifically: nothing at the cliff column, which is where the
    // unclipped renderer put a 1,000 m contour 5 km under water.
    expect(columnsOf(cells)).not.toContain(cliffCol);

    map.destroy();
    host.remove();
  });

  it("chooses a count-based level set INSIDE the window, not across the data's own range", () => {
    const { host, map } = mount();
    // Land runs the whole positive range (0 → 4,400 m) so all four in-window
    // levels have somewhere to cross; the ocean plateau (-5,000 m) is what
    // the unclipped level set wastes itself on.
    const field = stepField(-5000, 0, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: 4, minElevation: 0, color: "#00aaff" });
    map.scene.rerender();

    const profile = sampledProfile(map, field, 12);
    // Four evenly spaced levels over 0..4400 (the WINDOW), excluding both
    // ends — the same rule the unwindowed count uses, applied to the clipped
    // range: 880, 1760, 2640, 3520.
    const windowed = [1, 2, 3, 4].map((i) => (4400 * i) / 5);
    // What the count resolved to BEFORE the window existed, for contrast:
    // -3120, -1240, 640, 2520 — three of them under water.
    const unwindowed = [1, 2, 3, 4].map((i) => -5000 + 9400 * (i / 5));

    const expected = expectedColumns(profile, windowed);
    expect(expected).toHaveLength(4);
    expect(columnsOf(inkedCells(map))).toEqual(expected);
    // The two level sets must be genuinely distinguishable on this fixture,
    // or the assertion above would pass either way.
    expect(expectedColumns(profile, unwindowed)).not.toEqual(expected);

    map.destroy();
    host.remove();
  });

  it("clips an explicit array: an out-of-window level inks nothing, even where an IN-window cell detects its crossing", () => {
    const { host, map } = mount();
    // Mirrored, so the cliff's detecting cell (2,000 m — inside the floor)
    // sits west of the drop to -5,000 m. A -1,000 m level crosses between
    // them and would ink that in-window cell: the per-cell gate can't catch
    // it, only dropping the level itself can.
    const field = mirroredStepField(-5000, 2000, 4400);
    const profile = () => sampledProfile(map, field, 12);

    map.addLayer({ type: "contour", id: "c", source: field, levels: [-1000, 3000], minElevation: 0, color: "#00aaff" });
    map.scene.rerender();
    const trap = expectedColumns(profile(), [-1000]);
    expect(trap.length).toBeGreaterThan(0); // the fixture really does contain the case

    const inked = columnsOf(inkedCells(map));
    // Only the 3,000 m level survives the clip.
    expect(inked).toEqual(expectedColumns(profile(), [3000]));
    for (const col of trap) expect(inked).not.toContain(col);

    map.destroy();
    host.remove();
  });

  it("clips an { interval }'s absolute multiples without renumbering them", () => {
    const { host, map } = mount();
    const field = mirroredStepField(-5000, 2000, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: { interval: 3000 }, minElevation: 500, color: "#00aaff" });
    map.scene.rerender();
    const profile = sampledProfile(map, field, 12);

    // Multiples of 3,000 strictly inside the DATA range (-5,000..4,400) are
    // -3,000 / 0 / 3,000; the window keeps 3,000 alone — and keeps it at
    // 3,000, not at some level re-derived from the window's own edges (which
    // is what would make an interval's lines crawl as the view pans).
    expect(columnsOf(inkedCells(map))).toEqual(expectedColumns(profile, [3000]));
    // The dropped -3,000 / 0 levels both cross at the cliff, detected from
    // its in-window (2,000 m) side — so this fixture fails if they survive.
    expect(expectedColumns(profile, [-3000, 0]).length).toBeGreaterThan(0);

    map.destroy();
    host.remove();
  });

  it("ceiling only: keeps the sea floor and drops the land", () => {
    const { host, map } = mount();
    const field = stepField(-5000, 0, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: { interval: 1000 }, maxElevation: 0, color: "#00aaff" });
    map.scene.rerender();

    const profile = sampledProfile(map, field, 12);
    for (const { col, row } of inkedCells(map)) {
      const ll = map.unproject([col + 0.5, row + 0.5]);
      expect(ll ? glyphMapFieldValueAt(field, ll[0], ll[1]) : NaN).toBeLessThanOrEqual(0);
    }
    // The land ramp crosses 1000/2000/3000/4000 — every one of those columns
    // must be gone.
    expect(expectedColumns(profile, [1000, 2000, 3000, 4000]).length).toBeGreaterThan(0);
    for (const col of expectedColumns(profile, [1000, 2000, 3000, 4000])) {
      expect(columnsOf(inkedCells(map))).not.toContain(col);
    }

    map.destroy();
    host.remove();
  });

  it("an empty window (floor above ceiling) renders nothing, and does not throw", () => {
    const { host, map } = mount();
    const field = stepField(-5000, 0, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: 6, minElevation: 3000, maxElevation: 1000, color: "#00aaff" });
    expect(() => map.scene.rerender()).not.toThrow();
    expect(inkedCells(map)).toHaveLength(0);
    // Still a live, introspectable layer — an empty window is not an error
    // state, and the DATA range is still what the handle reports.
    expect(map.getContourFieldRange("c")).toEqual({ min: -5000, max: 4400 });
    map.destroy();
    host.remove();
  });

  it("a window the visible field never enters renders nothing, and does not throw", () => {
    const { host, map } = mount();
    const field = stepField(-5000, 0, 4400);
    map.addLayer({ type: "contour", id: "c", source: field, levels: { interval: 500 }, minElevation: 20000, maxElevation: 30000, color: "#00aaff" });
    expect(() => map.scene.rerender()).not.toThrow();
    expect(inkedCells(map)).toHaveLength(0);
    map.destroy();
    host.remove();
  });

  /**
   * BYTE IDENTITY for the default (no window declared) — one pin per `levels`
   * shape: 24 rows of 60 columns, ink on rows 6..17 (the field's own latitude
   * band), spaces everywhere else, `\n`-joined with no trailing newline —
   * 1,463 characters.
   *
   * RE-BASELINED when `contour` became real geometry: these rows were
   * recaptured from the marching-squares renderer, and the previous literals
   * (a `|` at columns [29, 34, 46] / [29, 30, 36, 43, 49, 56] / [29, 43]) are
   * recorded here because the DIFFERENCE is the feature, not noise. The per-
   * cell scan inked the cell that DETECTED a crossing, so a line wandered a
   * column between rows and the twelve rows of one straight contour were not
   * identical; the geometry stands at the crossing's own sub-cell position, so
   * every row of a vertical line is now byte-identical to every other and the
   * glyph carries the sub-cell offset (`▕`/`▏`) instead of rounding it away.
   * The property this pins is unchanged: declaring no window must render
   * exactly as not declaring one, for every `levels` shape.
   */
  const expandGolden = (inkRow: string): string =>
    Array.from({ length: ROWS }, (_, r) => (r >= 6 && r <= 17 ? inkRow : " ".repeat(COLS))).join("\n");

  it.each([
    { label: "a count", levels: 4 as number | readonly number[] | { readonly interval: number }, inkRow: "                             ▕▏   ▕            ▏            " },
    { label: "an { interval }", levels: { interval: 1000 }, inkRow: "                             ▕|      ▏     ▕      ▏     ▕   " },
    { label: "an explicit array", levels: [-3000, 2000], inkRow: "                             ▕             ▕                " },
  ])("declaring no window renders byte-identically to the pinned unwindowed render — $label", ({ levels, inkRow }) => {
    const { host, map } = mount();
    expect(inkRow).toHaveLength(COLS); // the literal must be the real width, trailing spaces included
    map.addLayer({ type: "contour", id: "c", source: stepField(-5000, 0, 4400), levels, color: "#00aaff" });
    map.scene.rerender();
    expect(map.scene.output.textContent).toBe(expandGolden(inkRow));
    map.destroy();
    host.remove();
  });

  it("getContourFieldRange reports the DATA range, unchanged by the window", () => {
    const { host, map } = mount();
    const field = stepField(-5000, 0, 4400);
    map.addLayer({ type: "contour", id: "windowed", source: field, levels: 4, minElevation: 0, maxElevation: 2000 });
    // The UI needs the data range to bound its own floor/ceiling sliders —
    // reporting the clipped range instead would let the sliders shrink onto
    // their own last value and never come back.
    expect(map.getContourFieldRange("windowed")).toEqual({ min: -5000, max: 4400 });
    map.destroy();
    host.remove();
  });
});
