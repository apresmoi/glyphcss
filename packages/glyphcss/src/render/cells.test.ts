import { describe, expect, it } from "vitest";
import {
  buildCellGrid,
  cloneCellGrid,
  encodeCellGrid,
  encodeGlyphBuffers,
  encodeGlyphBuffersDual,
  getGlyphColorParseCountForTests,
  resetGlyphColorParseCountForTests,
  type CellGrid,
} from "./cells";

// B7 spike: font-weight is an opt-in per-cell buffer threaded alongside the
// existing color buffer, so a weight-bearing span composes with color
// without ever changing default (no-weight) output.
describe("cells: weight-bearing spans (B7 spike)", () => {
  it("is absent by default: encodeGlyphBuffers output is unaffected by the new optional param", () => {
    const char = ["a", "b"];
    const color: (string | null)[] = ["#ff0000", "#ff0000"];
    const withoutParam = encodeGlyphBuffers(char, color, 2, 1, true);
    const withNullWeight = encodeGlyphBuffers(char, color, 2, 1, true, null);
    expect(withoutParam).toBe(`<span style="color:#ff0000">ab</span>`);
    expect(withNullWeight).toBe(withoutParam);
  });

  it("emits combined color+font-weight style for a non-zero weight cell", () => {
    const char = ["a", "b"];
    const color: (string | null)[] = ["#00ff00", "#00ff00"];
    const weight = [700, 700];
    const out = encodeGlyphBuffers(char, color, 2, 1, true, weight);
    expect(out).toBe(`<span style="color:#00ff00;font-weight:700">ab</span>`);
  });

  it("splits a run when weight changes even if color does not", () => {
    const char = ["a", "b", "c"];
    const color: (string | null)[] = ["#00ff00", "#00ff00", "#00ff00"];
    const weight = [0, 700, 700];
    const out = encodeGlyphBuffers(char, color, 3, 1, true, weight);
    expect(out).toBe(
      `<span style="color:#00ff00">a</span><span style="color:#00ff00;font-weight:700">bc</span>`,
    );
  });

  it("emits font-weight-only style when color is null", () => {
    const char = ["a"];
    const color: (string | null)[] = [null];
    const weight = [700];
    const out = encodeGlyphBuffers(char, color, 1, 1, true, weight);
    expect(out).toBe(`<span style="font-weight:700">a</span>`);
  });

  it("ignores weight entirely when useColors is false (plain textContent can't carry style)", () => {
    const char = ["a", "b"];
    const color: (string | null)[] = ["#00ff00", "#00ff00"];
    const weight = [700, 700];
    const out = encodeGlyphBuffers(char, color, 2, 1, false, weight);
    expect(out).toBe("ab");
  });

  it("buildCellGrid + encodeCellGrid roundtrips a weight buffer through the grid", () => {
    const char = ["a", "b"];
    const color: (string | null)[] = ["#0000ff", "#0000ff"];
    const weightSrc = new Uint16Array([700, 700]);
    const grid = buildCellGrid(char, color, null, 2, 1, null, null, null, null, null, null, null, weightSrc);
    expect(grid.weight).toBeInstanceOf(Uint16Array);
    expect(Array.from(grid.weight!)).toEqual([700, 700]);
    expect(encodeCellGrid(grid, true)).toBe(`<span style="color:#0000ff;font-weight:700">ab</span>`);
  });

  it("cloneCellGrid deep-copies the weight buffer", () => {
    const grid: CellGrid = {
      cols: 1,
      rows: 1,
      char: ["a"],
      color: [null],
      depth: new Float64Array([0]),
      screenX: new Int32Array([0]),
      screenY: new Int32Array([0]),
      weight: new Uint16Array([700]),
    };
    const clone = cloneCellGrid(grid);
    expect(clone.weight).not.toBe(grid.weight);
    expect(Array.from(clone.weight!)).toEqual([700]);
  });
});

// B4: two-color (`▀`/`▄`/`█`) span encoding for `charMode: "halfblock"`. This is
// a sibling encoder to `encodeGlyphBuffers` — it never touches `CellGrid`, so
// `transformCells` / the effect compositor stay one-color-per-cell.
describe("cells: encodeGlyphBuffersDual (B4 halfblock)", () => {
  it("emits ▀ with fg=color (top) and bg=background-color (bottom) when the two subcell colors differ", () => {
    const char = ["▀"];
    const fg: (string | null)[] = ["#ff0000"];
    const bg: (string | null)[] = ["#0000ff"];
    const out = encodeGlyphBuffersDual(char, fg, bg, 1, 1, true);
    expect(out).toBe(`<span style="color:#ff0000;background-color:#0000ff">▀</span>`);
  });

  it("merges consecutive cells into one span only when BOTH fg and bg match", () => {
    // Cells 0/1 share fg AND bg → one run. Cell 2 shares fg but differs on bg
    // → a new run must start (single-color dedupe would wrongly merge it).
    const char = ["▀", "▀", "▀"];
    const fg: (string | null)[] = ["#ff0000", "#ff0000", "#ff0000"];
    const bg: (string | null)[] = ["#0000ff", "#0000ff", "#00ff00"];
    const out = encodeGlyphBuffersDual(char, fg, bg, 3, 1, true);
    expect(out).toBe(
      `<span style="color:#ff0000;background-color:#0000ff">▀▀</span>`
      + `<span style="color:#ff0000;background-color:#00ff00">▀</span>`,
    );
  });

  it("merges equal-colored neighbors (same fg, no bg) into a single run", () => {
    const char = ["█", "█", "█"];
    const fg: (string | null)[] = ["#123456", "#123456", "#123456"];
    const bg: (string | null)[] = [null, null, null];
    const out = encodeGlyphBuffersDual(char, fg, bg, 3, 1, true);
    expect(out).toBe(`<span style="color:#123456">███</span>`);
  });

  it("paints no background for an empty cell (no opaque rectangle over nothing)", () => {
    const char = [" "];
    const fg: (string | null)[] = [null];
    const bg: (string | null)[] = [null];
    const out = encodeGlyphBuffersDual(char, fg, bg, 1, 1, true);
    expect(out).toBe(" ");
  });

  it("paints no background for a half-covered cell (only fg set)", () => {
    // Top-only coverage: ▀ with a foreground color and no background — the
    // uncovered bottom half must show through to the page background, not
    // an opaque rectangle.
    const char = ["▀"];
    const fg: (string | null)[] = ["#ff0000"];
    const bg: (string | null)[] = [null];
    const out = encodeGlyphBuffersDual(char, fg, bg, 1, 1, true);
    expect(out).toBe(`<span style="color:#ff0000">▀</span>`);
  });

  it("ignores colors entirely when useColors is false (plain textContent)", () => {
    const char = ["▀", "█", " "];
    const fg: (string | null)[] = ["#ff0000", "#00ff00", null];
    const bg: (string | null)[] = ["#0000ff", null, null];
    const out = encodeGlyphBuffersDual(char, fg, bg, 3, 1, false);
    expect(out).toBe("▀█ ");
  });

  it("rejects glyphs that cannot occupy exactly one monospace cell", () => {
    expect(() => encodeGlyphBuffersDual(["́"], [null], [null], 1, 1, false)).toThrow(/one printable glyph/);
  });
});

// COLOR-TOLERANCE.md Phase 1: row-wise greedy run-extension against an
// anchor color, gated behind `colorTolerance` (default 0 = off). A fixed,
// realistic multi-color grid (four color bands with in-band jitter and a
// scattering of blank cells) backs the monotonicity/error/parse-count
// contract tests, rather than a two-point smoke check on a couple of cells.
describe("cells: encodeGlyphBuffers colorTolerance (COLOR-TOLERANCE.md Phase 1)", () => {
  const COLS = 48;
  const ROWS = 8;
  // Four visually distinct bands (red/green/blue/yellow), 12 cols each, with
  // small deterministic in-band jitter so adjacent cells are close but not
  // identical — the shape real shaded/textured content has. A few blank
  // (space) cells are scattered in to exercise anchor reset.
  const BAND_COLORS: readonly [number, number, number][] = [
    [220, 40, 40],
    [40, 200, 90],
    [50, 90, 220],
    [230, 200, 40],
  ];

  function buildColorToleranceGrid(): {
    char: string[];
    color: (string | null)[];
    cols: number;
    rows: number;
  } {
    const char: string[] = [];
    const color: (string | null)[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const isBlank = (row === 2 || row === 5) && col % 17 === 0;
        if (isBlank) {
          char.push(" ");
          color.push(null);
          continue;
        }
        const band = Math.floor(col / 12) % BAND_COLORS.length;
        const [br, bg, bb] = BAND_COLORS[band]!;
        const jitter = ((col % 12) + row * 3) % 7; // 0..6, deterministic
        const r = Math.min(255, br + jitter);
        const g = Math.min(255, bg + ((jitter * 2) % 5));
        const b = Math.min(255, bb + (jitter % 4));
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        char.push("*");
        color.push(hex);
      }
    }
    return { char, color, cols: COLS, rows: ROWS };
  }

  /** Independent redmean re-implementation for the bounded-error assertion —
   * deliberately not the internal helper, so the test doesn't validate the
   * implementation against itself. */
  function redmeanDistance(hexA: string, hexB: string): number {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    const rm = (ar + br) / 2;
    const dr = ar - br;
    const dg = ag - bg;
    const db = ab - bb;
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  }

  /** Reconstruct one decoded color (or `null`) per grid cell, in row-major
   * order, from an `encodeGlyphBuffers` HTML string — the inverse of the
   * encoder's own run/span structure, walked independently. */
  function decodeSpanColors(html: string): (string | null)[] {
    const colors: (string | null)[] = [];
    const re = /<span style="color:(#[0-9a-fA-F]{6})">([^<]*)<\/span>|([^<\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (match[1] !== undefined) {
        for (let i = 0; i < match[2]!.length; i++) colors.push(match[1]!);
      } else if (match[3] !== undefined) {
        for (let i = 0; i < match[3].length; i++) colors.push(null);
      }
    }
    return colors;
  }

  function spanCount(html: string): number {
    return (html.match(/<span /g) ?? []).length;
  }

  it("colorTolerance: 0 is byte-identical to omitting the parameter, on every existing case", () => {
    const { char, color, cols, rows } = buildColorToleranceGrid();
    const omitted = encodeGlyphBuffers(char, color, cols, rows, true);
    const explicitZero = encodeGlyphBuffers(char, color, cols, rows, true, null, 0);
    expect(explicitZero).toBe(omitted);

    // Also cover a grid with near-but-not-identical adjacent colors that
    // WOULD merge under any tolerance > 0 — confirms 0 keeps the exact
    // string-equality behavior rather than accidentally tolerating anything.
    const near = ["#100000", "#110000", "#120000"];
    const chars = ["a", "b", "c"];
    const out = encodeGlyphBuffers(chars, near, 3, 1, true, null, 0);
    expect(out).toBe(
      `<span style="color:#100000">a</span>`
      + `<span style="color:#110000">b</span>`
      + `<span style="color:#120000">c</span>`,
    );
  });

  it("span count is non-increasing as colorTolerance rises, over a fixed captured grid", () => {
    const { char, color, cols, rows } = buildColorToleranceGrid();
    const tolerances = [0, 4, 8, 16, 24, 32, 48, 64, 96, 128];
    const spanCounts = tolerances.map((t) => spanCount(encodeGlyphBuffers(char, color, cols, rows, true, null, t)));

    for (let i = 1; i < spanCounts.length; i++) {
      expect(spanCounts[i]!).toBeLessThanOrEqual(spanCounts[i - 1]!);
    }
    // Meaningful, not a two-point smoke check: the lever actually moves
    // across this multi-band, multi-tolerance sweep.
    expect(spanCounts[spanCounts.length - 1]!).toBeLessThan(spanCounts[0]!);
  });

  it("no cell's output colour differs from its true colour by more than colorTolerance (redmean)", () => {
    const { char, color, cols, rows } = buildColorToleranceGrid();
    const tolerance = 28;
    const out = encodeGlyphBuffers(char, color, cols, rows, true, null, tolerance);
    const decoded = decodeSpanColors(out);
    expect(decoded.length).toBe(cols * rows);

    let mergedSomeCell = false;
    for (let i = 0; i < decoded.length; i++) {
      const truth = color[i];
      const observed = decoded[i];
      if (truth === null) {
        expect(observed).toBeNull();
        continue;
      }
      expect(observed).not.toBeNull();
      const dist = redmeanDistance(truth, observed!);
      expect(dist).toBeLessThanOrEqual(tolerance + 1e-6);
      if (observed !== truth) mergedSomeCell = true;
    }
    // Meaningful: the tolerance actually substituted some cell's true color
    // for its anchor's, not merely a vacuous pass with observed === truth
    // everywhere.
    expect(mergedSomeCell).toBe(true);
  });

  it("bounds colour parses per encode by the pre-merge span count, not the cell count", () => {
    const { char, color, cols, rows } = buildColorToleranceGrid();
    const tolerance = 20;
    const preMergeSpanCount = spanCount(encodeGlyphBuffers(char, color, cols, rows, true, null, 0));

    resetGlyphColorParseCountForTests();
    encodeGlyphBuffers(char, color, cols, rows, true, null, tolerance);
    const parseCount = getGlyphColorParseCountForTests();

    expect(parseCount).toBeGreaterThan(0);
    expect(parseCount).toBeLessThanOrEqual(preMergeSpanCount);
    expect(parseCount).toBeLessThan(cols * rows);

    // Repeating the same encode call must not accumulate parses across
    // calls — the memo is call-scoped, not persistent.
    resetGlyphColorParseCountForTests();
    encodeGlyphBuffers(char, color, cols, rows, true, null, tolerance);
    expect(getGlyphColorParseCountForTests()).toBe(parseCount);
  });
});
