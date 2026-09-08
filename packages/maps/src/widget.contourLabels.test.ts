/**
 * `GlyphMapContourLayer.labels` — elevation labels on contour lines.
 *
 * WHAT IS BEING PINNED, and why each assertion is shaped the way it is.
 *
 *  1. INDEX CONTOURS ONLY. Real topo sheets label every 5th line, not every
 *     line, or the map becomes a page of numbers. So the test asserts a
 *     level-by-level fingerprint: exactly the index rows carry digits, and
 *     every other contour row is an unbroken run of ink.
 *  2. THE LABEL BREAKS ITS OWN LINE. Asserted as an EXACT row literal — the
 *     blank cell either side of the number, and the ink resuming immediately
 *     after it — not as an ink count. A count would pass for a number simply
 *     painted on top of an unbroken line.
 *  3. OFF IS BYTE-IDENTICAL. A golden literal for the whole `<pre>`, with
 *     `labels` omitted and with `labels: false`, both compared against the
 *     same bytes and against each other.
 *  4. DECLUTTER. The exact greedy invariant is asserted over every pair of
 *     placed labels, on a fixture (`labelEvery: 1`) whose contour rows are
 *     one row apart and therefore genuinely contend.
 *  5. THE ELEVATION WINDOW and THE GLOBE HORIZON, both of which a label
 *     inherits from the ink it is derived from — asserted rather than
 *     assumed, since "derived from" is exactly the kind of claim that stops
 *     being true the moment placement grows its own geometry.
 *
 * FIXTURE NOTES.
 *  - Elevation is a function of LATITUDE only, so every contour runs
 *    east-west and is exactly the near-horizontal line a label may lie
 *    along. (The sibling `widget.contourRange.test.ts` fixture ramps with
 *    LONGITUDE, which makes every contour vertical and — correctly —
 *    unlabellable; the two fixtures are deliberately perpendicular.)
 *  - No `raster` layer is mounted, so `requireSurface` degrades to false and
 *    the base grid stays blank: every non-space character in the output is
 *    this layer's own contour ink or its own label.
 *  - Assertions key on ROWS and on exact cells. A column alone is ambiguous
 *    on the globe (`sin(180 - L) === sin(L)`, so a far-side point shares its
 *    near-side twin's column), and an ink COUNT across a whole row is what
 *    lets a broken fix survive: both are avoided here.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createGlyphMap,
  glyphMapContourIndexLevels,
  GLYPH_MAP_CONTOUR_LABEL_PAD_X,
  GLYPH_MAP_CONTOUR_LABEL_PAD_Y,
} from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapField } from "./types";

const COLS = 60;
const ROWS = 40;
const SPAN = 40;

/**
 * Elevation ramps linearly with latitude and is constant along each parallel
 * — so a level inks exactly one ROW, right across the grid, and the set of
 * inked rows is an exact fingerprint of the level list.
 */
function latRampField(min: number, max: number, cols = COLS, rows = ROWS, bounds = { west: -SPAN / 2, east: SPAN / 2, south: -(SPAN * ROWS) / COLS / 2, north: (SPAN * ROWS) / COLS / 2 }): GlyphMapField {
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const v = min + (max - min) * (row / (rows - 1));
    for (let col = 0; col < cols; col++) values[row * cols + col] = v;
  }
  return { bounds, cols, rows, values, noData: new Uint8Array(cols * rows), kind: "continuous", min, max };
}

function mount(cols = COLS, rows = ROWS) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: SPAN, cols, rows },
    projection: glyphMapEquirectangular(),
    // Straight top-down: relief affects depth only, never screen X/Y, so a
    // parallel stays a row.
    tilt: 0,
  });
  return { host, map };
}

const linesOf = (map: ReturnType<typeof createGlyphMap>): string[] => (map.scene.output.textContent ?? "").split("\n");

/** Every maximal run of digits in the output — one entry per painted label. */
function labelRuns(map: ReturnType<typeof createGlyphMap>): { row: number; col: number; text: string }[] {
  const out: { row: number; col: number; text: string }[] = [];
  linesOf(map).forEach((line, row) => {
    for (const match of line.matchAll(/\d+/g)) out.push({ row, col: match.index, text: match[0] });
  });
  return out;
}

/**
 * The golden UNLABELLED render: 12 interval levels over the visible band, one
 * unbroken 60-cell rule per level, nothing else.
 *
 * The GLYPH is part of the pin and carries real information now that a
 * contour is geometry: `inkGlyphForTangent` picks the oriented glyph from the
 * stroke's own SUB-CELL position, so a horizontal line sitting in the lower
 * part of its cell reads `_` and one in the upper part `▔`. The per-cell scan
 * had no sub-cell position to offer and passed 0.5, so every line read `-`
 * and a level's true height inside a cell was rounded away. Twelve evenly
 * spaced levels landing alternately low and high in their cells is exactly
 * what that recovers.
 */
const UNLABELLED_INK = new Map<number, string>([
  [11, "_"], [13, "▔"], [14, "_"], [16, "▔"], [17, "_"], [19, "▔"],
  [20, "_"], [22, "▔"], [23, "_"], [25, "▔"], [26, "_"], [28, "▔"],
]);
const UNLABELLED_INK_ROWS = [...UNLABELLED_INK.keys()];
const unlabelledGolden = (): string =>
  Array.from({ length: ROWS }, (_, row) => (UNLABELLED_INK.get(row) ?? " ").repeat(COLS)).join("\n");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("glyphMapContourIndexLevels", () => {
  it("anchors an { interval } list's index contours to absolute elevation", () => {
    const levels = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
    // Multiples of 1000 * 5 — the elevations a paper sheet would print.
    expect(glyphMapContourIndexLevels(levels, 1000, 5)).toEqual([5000, 10000]);
    // And that answer does not depend on where the visible list STARTS: drop
    // the bottom four levels (a pan that lifted the visible floor) and the
    // same two elevations are still the index contours. A position-in-array
    // rule would have renumbered every label on the map.
    expect(glyphMapContourIndexLevels(levels.slice(4), 1000, 5)).toEqual([5000, 10000]);
  });

  it("picks an every-Nth subset of a count-derived list, whose levels sit on no absolute ladder", () => {
    const min = -5000;
    const step = 9400 / 21;
    const levels = Array.from({ length: 20 }, (_, i) => min + step * (i + 1));
    const picked = glyphMapContourIndexLevels(levels, step, 5);
    expect(picked).toHaveLength(4);
    // Consecutive picks are exactly five rungs apart — an every-5th subset,
    // not an accident of float rounding.
    expect(picked.map((l) => Math.round((l - picked[0]) / step))).toEqual([0, 5, 10, 15]);
  });

  it("labels every level when the list sits on no every-Nth rung of its own ladder", () => {
    // A two-level authored array: silently labelling neither is worse than
    // labelling both.
    expect(glyphMapContourIndexLevels([1000, 3000], 2000, 5)).toEqual([1000, 3000]);
  });

  it("labels every level at labelEvery 1, and when there is no ladder to count along", () => {
    expect(glyphMapContourIndexLevels([100, 200, 300], 100, 1)).toEqual([100, 200, 300]);
    expect(glyphMapContourIndexLevels([100, 200, 300], 0, 5)).toEqual([100, 200, 300]);
  });
});

describe("createGlyphMap — contour labels", () => {
  it("labels only the index contours, in a gap in the line, at exact cells", () => {
    const { host, map } = mount();
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, color: "#00aaff" });
    map.scene.rerender();
    const lines = linesOf(map);

    // Row 17 carries the 5,000 m contour and row 25 the 10,000 m one — the
    // only two of the twelve levels that are multiples of 1000 * 5. Each row
    // is asserted as an EXACT literal: the number sits in a one-cell gap on
    // both sides, and the rule resumes immediately after it, in that line's
    // own sub-cell glyph.
    expect(lines[17]).toBe(` 5000 ${"_".repeat(22)} 5000 ${"_".repeat(26)}`);
    expect(lines[25]).toBe(` 10000 ${"▔".repeat(22)} 10000 ${"▔".repeat(24)}`);

    // Every OTHER contour row is untouched — an unbroken rule, no digits, no
    // stray gap. This is what makes it "every 5th line" rather than "some
    // lines".
    for (const [row, glyph] of UNLABELLED_INK) {
      if (row === 17 || row === 25) continue;
      expect({ row, line: lines[row] }).toEqual({ row, line: glyph.repeat(COLS) });
    }
    // And no digit escapes onto a row that carries no contour at all.
    expect([...new Set(labelRuns(map).map((r) => r.row))].sort((a, b) => a - b)).toEqual([17, 25]);

    map.destroy();
    host.remove();
  });

  it("renders byte-identically to the unlabelled render when labels are off or omitted", () => {
    const golden = unlabelledGolden();
    for (const labels of [undefined, false]) {
      const { host, map } = mount();
      map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels, color: "#00aaff" });
      map.scene.rerender();
      expect({ labels, text: map.scene.output.textContent }).toEqual({ labels, text: golden });
      map.destroy();
      host.remove();
    }
    // The golden must be genuinely distinguishable from the labelled render,
    // or the identity assertion above would hold no matter what labels did.
    const { host, map } = mount();
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, color: "#00aaff" });
    map.scene.rerender();
    expect(map.scene.output.textContent).not.toBe(golden);
    map.destroy();
    host.remove();
  });

  it("never places two labels whose declutter boxes overlap", () => {
    const { host, map } = mount();
    // `labelEvery: 1` makes all twelve levels index contours, so contour rows
    // one and two rows apart all contend for a label at once — without the
    // declutter this fixture paints a number on every one of them.
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, labelEvery: 1, color: "#00aaff" });
    map.scene.rerender();

    const runs = labelRuns(map);
    expect(runs.length).toBeGreaterThan(1);
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        // The greedy declutter's own box: the text, grown by the padding, and
        // centred on the anchor. Two placed labels must be clear of each
        // other on at least one axis.
        const aw = a.text.length + GLYPH_MAP_CONTOUR_LABEL_PAD_X * 2;
        const bw = b.text.length + GLYPH_MAP_CONTOUR_LABEL_PAD_X * 2;
        const aCenter = a.col + a.text.length / 2;
        const bCenter = b.col + b.text.length / 2;
        const clearX = Math.abs(aCenter - bCenter) >= (aw + bw) / 2;
        const clearY = Math.abs(a.row - b.row) >= 1 + GLYPH_MAP_CONTOUR_LABEL_PAD_Y * 2;
        expect({ a, b, clear: clearX || clearY }).toEqual({ a, b, clear: true });
      }
    }
    // The declutter really did reject candidates here, rather than the
    // fixture happening to offer non-contending ones.
    expect(new Set(runs.map((r) => r.row)).size).toBeLessThan(UNLABELLED_INK_ROWS.length);

    map.destroy();
    host.remove();
  });

  it("never labels a level outside the elevation window", () => {
    const { host, map } = mount();
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, maxElevation: 7000, color: "#00aaff" });
    map.scene.rerender();

    const texts = labelRuns(map).map((r) => r.text);
    expect(texts.length).toBeGreaterThan(0); // the 5,000 m label survives the ceiling
    // 10,000 m is above the ceiling, so its level is dropped from the list —
    // and with it its ink, and with that its label. The field really does
    // reach 13,000 m, so this is the level being clipped, not absent data.
    expect(new Set(texts)).toEqual(new Set(["5000"]));
    // Every label names an elevation inside the window, taken as a number
    // rather than as a string so a formatting change cannot hide a breach.
    for (const text of texts) expect(Number(text)).toBeLessThanOrEqual(7000);
    map.destroy();
    host.remove();
  });

  it("keeps labels on the near side of the globe", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 120, cols: 80, rows: 40 },
      projection: glyphMapGlobe({ radius: 1 }),
    });
    map.addLayer({
      type: "contour",
      id: "c",
      source: latRampField(0, 13000, 180, 90, { west: -180, east: 180, south: -90, north: 90 }),
      levels: { interval: 1000 },
      labels: true,
      color: "#00aaff",
    });
    map.scene.rerender();

    const runs = labelRuns(map);
    expect(runs.length).toBeGreaterThan(0); // the globe is labelled at all
    for (const run of runs) {
      for (let i = 0; i < run.text.length; i++) {
        // The horizon rule, stated exactly as the stroke path states it:
        // `unproject` refuses a cell with no near-side surface point, so a
        // non-null answer at every cell of every label is "no label, and no
        // part of one, on the far side".
        expect({ ...run, cell: run.col + i, nearSide: map.unproject([run.col + i + 0.5, run.row + 0.5]) !== null })
          .toEqual({ ...run, cell: run.col + i, nearSide: true });
      }
    }
    map.destroy();
    host.remove();
  });

  it("does not flicker across sub-cell pans", () => {
    const { host, map } = mount();
    map.addLayer({ type: "contour", id: "c", source: latRampField(0, 13000), levels: { interval: 1000 }, labels: true, color: "#00aaff" });

    // A contour's own row moves as the view pans — that is the terrain
    // moving, not instability. What must NOT change is WHICH levels carry a
    // label and HOW MANY there are: a label winking out for a frame and back
    // is the failure this guards.
    const degPerCell = SPAN / COLS;
    const frames: string[] = [];
    const rows: number[][] = [];
    for (let step = 0; step < 8; step++) {
      map.setView({ center: [0, (degPerCell * step) / 8] });
      map.scene.rerender();
      const runs = labelRuns(map);
      frames.push(runs.map((r) => r.text).sort().join(","));
      rows.push([...new Set(runs.map((r) => r.row))].sort((a, b) => a - b));
    }
    expect(new Set(frames).size).toBe(1);
    expect(frames[0]).toBe("10000,10000,5000,5000");
    // Non-vacuous: the pan really did move the terrain under the labels, and
    // each label followed its own line rather than staying pinned to a row.
    expect(rows[rows.length - 1]).not.toEqual(rows[0]);
    // And it moved SMOOTHLY — never more than one row between consecutive
    // sub-cell frames, which is what "rides with the line" means as opposed
    // to "jumps to a different contour".
    for (let step = 1; step < rows.length; step++) {
      const hops = rows[step].map((row, i) => Math.abs(row - rows[step - 1][i]));
      expect({ step, maxHop: Math.max(...hops) <= 1 }).toEqual({ step, maxHop: true });
    }

    map.destroy();
    host.remove();
  });
});
