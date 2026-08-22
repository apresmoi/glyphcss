import { describe, expect, it } from "vitest";
import {
  buildCellGrid,
  cloneCellGrid,
  encodeCellGrid,
  encodeGlyphBuffers,
  encodeGlyphBuffersDual,
  getGlyphColorParseCountForTests,
  getGlyphColorToleranceCallCountForTests,
  resetGlyphColorParseCountForTests,
  resetGlyphColorToleranceCallCountForTests,
  type CellGrid,
} from "./cells";

/** Independent redmean re-implementation for bounded-error assertions —
 * deliberately not the internal helper, so a test doesn't validate the
 * implementation against itself. Shared by the single-color (Phase 1) and
 * dual-color (Phase 2) `colorTolerance` suites below. */
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
//
// One dedicated row is a smooth ~128-cell linear gradient rather than banded
// jitter. The banded rows alone cannot catch a regression to comparing each
// candidate against the PREVIOUS cell instead of the anchor: in-band jitter
// is at most ~6/channel (max in-band redmean distance 11.36) and band
// boundaries jump far past any tested tolerance anyway, so every band already
// sits inside tolerance regardless of run policy — confirmed by mutation: an
// anchor->previous rewrite of `withinColorTolerance`'s caller still passed
// every test against the banded-only fixture. A monotonic ramp is the
// opposite shape: each step is tiny (~2/channel, comfortably inside
// tolerance against the PREVIOUS cell), but the drift compounds over many
// cells, so a chain that only checks its immediate neighbor wanders far past
// tolerance from where the run actually started while the anchor-based
// encoder keeps re-anchoring and stays bounded.
describe("cells: encodeGlyphBuffers colorTolerance (COLOR-TOLERANCE.md Phase 1)", () => {
  const COLS = 128;
  const ROWS = 10;
  const GRADIENT_ROW = ROWS - 2;
  const FLAT_ROW = ROWS - 1;
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
        if (row === GRADIENT_ROW) {
          // Monotonic ramp: R climbs ~0 -> 250 across the row (~1.97/cell),
          // G/B fixed. Each single step is small; the cumulative drift over
          // the whole row is large — exactly the shape that separates
          // anchor-based from previous-based run extension.
          const r = Math.round((col / (COLS - 1)) * 250);
          const hex = `#${[r, 128, 90].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          char.push("*");
          color.push(hex);
          continue;
        }
        if (row === FLAT_ROW) {
          // Two long flat runs of a LITERALLY REPEATED color string (64 cols
          // each). At tolerance 0 this is already only 2 spans (string
          // equality merges it for free) — the gap between that pre-merge
          // span count and the cell count is exactly what the `===` fast
          // path is for: every one of these ~126 repeat cells should cost
          // zero `withinColorTolerance` calls. Without banded jitter's near-
          // total absence of exact repeats, deleting the fast path has
          // nowhere to add extra calls; this row gives it somewhere.
          const hex = col < COLS / 2 ? "#204060" : "#605020";
          char.push("*");
          color.push(hex);
          continue;
        }
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

  // NOT a general guarantee — see COLOR-TOLERANCE.md's "Strongly monotone in
  // practice — but NOT guaranteed" and the counterexample test right below
  // this one. This only asserts the measured behavior on THIS fixed fixture
  // at these specific tolerance points; greedy re-anchoring admits local
  // non-monotonicity in general.
  it("span count is non-increasing as colorTolerance rises, on this fixed captured grid (measured, not a general guarantee)", () => {
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

  // Documents the known limitation rather than leaving it implicit: greedy
  // re-anchoring can make a HIGHER tolerance produce MORE spans on a specific
  // captured sequence (COLOR-TOLERANCE.md's own counterexample). A larger
  // tolerance lets the first run swallow one more cell, which moves the next
  // anchor to a strictly worse centre. Pinned so nobody "fixes" this later as
  // a regression — it is the documented, accepted shape of greedy
  // re-anchoring, not a bug.
  it("documents a real non-monotonic counterexample: tolerance 60 produces MORE spans than tolerance 40", () => {
    const char = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const color: (string | null)[] = [
      "#409640",
      "#407840",
      "#406440",
      "#408c40",
      "#406440",
      "#406440",
      "#406440",
      "#406440",
    ];
    const spans40 = spanCount(encodeGlyphBuffers(char, color, 8, 1, true, null, 40));
    const spans60 = spanCount(encodeGlyphBuffers(char, color, 8, 1, true, null, 60));
    expect(spans40).toBe(2);
    expect(spans60).toBe(4);
    expect(spans60).toBeGreaterThan(spans40);
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

  // The parse-count bound above can't fail while the memo exists: parses are
  // bounded by the number of DISTINCT color strings, which is <= run count
  // even at tolerance 0 with no cost machinery involved at all — deleting the
  // `===` fast path entirely (forcing a numeric compare on every mismatched
  // cell instead of only the first cell of a run) still leaves parses bounded
  // the same way, so that test cannot observe the fast path regressing.
  // What COLOR-TOLERANCE.md's "Cost" section actually sells is that the fast
  // path keeps NUMERIC comparisons (`withinColorTolerance` calls) bounded by
  // the pre-merge span count, not the cell count — so this test counts calls,
  // not parses.
  it("bounds withinColorTolerance calls per encode by the pre-merge span count, not the cell count", () => {
    const { char, color, cols, rows } = buildColorToleranceGrid();
    const tolerance = 20;
    const preMergeSpanCount = spanCount(encodeGlyphBuffers(char, color, cols, rows, true, null, 0));

    resetGlyphColorToleranceCallCountForTests();
    encodeGlyphBuffers(char, color, cols, rows, true, null, tolerance);
    const callCount = getGlyphColorToleranceCallCountForTests();

    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThanOrEqual(preMergeSpanCount);
    expect(callCount).toBeLessThan(cols * rows);

    // Repeating the same encode call must not accumulate calls across calls —
    // the counter is call-scoped instrumentation, not persistent.
    resetGlyphColorToleranceCallCountForTests();
    encodeGlyphBuffers(char, color, cols, rows, true, null, tolerance);
    expect(getGlyphColorToleranceCallCountForTests()).toBe(callCount);
  });

  // Finding 3 (COLOR-TOLERANCE.md review, Phase 1): the `colorTolerance > 0`
  // guard gates BOTH the tolerance machinery's allocation (the per-call
  // `Map` cache) and whether same-numeric-value-but-different-string colors
  // (case-variant hex) can merge. Mutating the guard to `>= 0` passes every
  // other test in this file but (a) allocates the cache on every default-path
  // call and (b) lets two literally-distinct color strings with redmean
  // distance 0 merge at the nominally-off tolerance.
  it("colorTolerance 0 (default/off) never engages the tolerance machinery: case-variant hex colors stay distinct spans and cost zero parses", () => {
    const chars = ["a", "b"];
    // Same underlying RGB (0xAABBCC), different string casing -> redmean
    // distance 0. If the `> 0` guard ever admitted tolerance 0 into the
    // numeric path, these would incorrectly merge into one span.
    const colors: (string | null)[] = ["#AABBCC", "#aabbcc"];

    resetGlyphColorParseCountForTests();
    const outDefault = encodeGlyphBuffers(chars, colors, 2, 1, true);
    const outExplicitZero = encodeGlyphBuffers(chars, colors, 2, 1, true, null, 0);
    const expected =
      `<span style="color:#AABBCC">a</span>` + `<span style="color:#aabbcc">b</span>`;
    expect(outDefault).toBe(expected);
    expect(outExplicitZero).toBe(expected);
    // Zero color parses: the cache is never allocated or consulted on the
    // off path, so `withinColorTolerance`/`packColorCached` never run.
    expect(getGlyphColorParseCountForTests()).toBe(0);
  });

  // COLOR-TOLERANCE.md Phase 2, interaction 3 (`solidWeightRamp`): tolerance
  // is colour-only, so a weight change must still force a new run even when
  // both the outgoing and incoming colour are well within tolerance of each
  // other. Phase 1's reviewer already mutation-checked this at the encoder
  // level with tolerance absent; this pins it with tolerance ACTIVE and a
  // realistic weighted-ramp step sequence (400/500/600/700, the shape
  // `calibrateWeightedGlyphRamp` produces), not just a synthetic 0/700 pair.
  it("solidWeightRamp: a weight change still breaks a run even when color is within tolerance", () => {
    const char = ["a", "b", "c", "d"];
    // All four colors are mutually within redmean ~7 of each other (tight
    // in-band jitter) — comfortably inside tolerance 40 — so color alone
    // would merge all four into one run.
    const color: (string | null)[] = ["#404040", "#414040", "#424040", "#434040"];
    const weight = [400, 400, 500, 500];
    const out = encodeGlyphBuffers(char, color, 4, 1, true, weight, 40);
    // Weight still splits the run in two — a new run (and a fresh color
    // anchor, re-seeded from the first cell of the new weight group) starts
    // exactly where weight changes, even though every color here is within
    // tolerance of every other. Color tolerance keeps merging within each
    // weight group.
    expect(out).toBe(
      `<span style="color:#404040;font-weight:400">ab</span>`
      + `<span style="color:#424040;font-weight:500">cd</span>`,
    );
  });
});

// COLOR-TOLERANCE.md Phase 2, interaction 1 (`charMode: "halfblock"` /
// `"quadrant"`): both use `encodeGlyphBuffersDual`, whose run key is TWO
// independent colors (`fg`/`bg`). Measured against a REAL rendered scene (a
// smooth-shaded icosphere through the real `rasterize()` +
// `charMode: "halfblock"`/`"quadrant"` pipeline, 140x50 grid, per-cell
// buffers losslessly reconstructed from the real HTML output and re-encoded
// through this same encoder at rising tolerance): requiring BOTH channels to
// hold makes the win smaller than the single-color path (1.5x-2.2x span
// reduction at tolerance 32-128, vs. 1.6x-31x for `encodeGlyphBuffers`), but
// it is real and never zero — so this ships rather than being a documented
// no-op, unlike interaction 2 below.
describe("cells: encodeGlyphBuffersDual colorTolerance (COLOR-TOLERANCE.md Phase 2)", () => {
  function spanCount(html: string): number {
    return (html.match(/<span /g) ?? []).length;
  }

  /** Reconstruct one decoded `{fg, bg}` pair per grid cell, in row-major
   * order, from an `encodeGlyphBuffersDual` HTML string — the two-channel
   * sibling of the Phase 1 suite's `decodeSpanColors`, independent of the
   * encoder's own run/span structure. */
  function decodeDualSpanColors(html: string): { fg: string | null; bg: string | null }[] {
    const out: { fg: string | null; bg: string | null }[] = [];
    const re = /<span style="([^"]*)">([^<]*)<\/span>|([^<\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (match[1] !== undefined) {
        const style = match[1]!;
        const fgMatch = style.match(/(?<!background-)color:(#[0-9a-fA-F]{6})/);
        const bgMatch = style.match(/background-color:(#[0-9a-fA-F]{6})/);
        const fg = fgMatch ? fgMatch[1]! : null;
        const bg = bgMatch ? bgMatch[1]! : null;
        for (let i = 0; i < match[2]!.length; i++) out.push({ fg, bg });
      } else if (match[3] !== undefined) {
        for (let i = 0; i < match[3].length; i++) out.push({ fg: null, bg: null });
      }
    }
    return out;
  }

  /** The smooth 64-cell two-channel row shared by the monotonicity and
   * bounded-error tests below — fg and bg drift in OPPOSITE directions so
   * neither channel is a scaled copy of the other. */
  function buildDualSmoothGrid(): { char: string[]; fg: (string | null)[]; bg: (string | null)[]; cols: number } {
    const cols = 64;
    const char: string[] = [];
    const fg: (string | null)[] = [];
    const bg: (string | null)[] = [];
    for (let col = 0; col < cols; col++) {
      const t = col / (cols - 1);
      const fr = Math.round(40 + t * 180);
      const br = Math.round(180 - t * 140);
      char.push("▀");
      fg.push(`#${[fr, 80, 90].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      bg.push(`#${[br, 60, 70].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    }
    return { char, fg, bg, cols };
  }

  it("colorTolerance: 0 is byte-identical to omitting the parameter", () => {
    const char = ["▀", "▀", "█", " ", "▄"];
    const fg: (string | null)[] = ["#ff0000", "#ff1000", "#123456", null, "#00ff00"];
    const bg: (string | null)[] = ["#0000ff", "#0000ee", null, null, null];
    const omitted = encodeGlyphBuffersDual(char, fg, bg, 5, 1, true);
    const explicitZero = encodeGlyphBuffersDual(char, fg, bg, 5, 1, true, 0);
    expect(explicitZero).toBe(omitted);

    // Meaningful beyond a span-count smoke check (P3, COLOR-TOLERANCE.md
    // review): near-but-distinct fg (redmean ~16, cells 0/1) stays unmerged,
    // and every decoded cell matches its true input color exactly — a
    // spanCount-only assertion can't distinguish "nothing merged" from a
    // different also-4-span merge pattern, but a full per-cell truth match
    // can.
    const decoded = decodeDualSpanColors(omitted);
    expect(decoded).toEqual([
      { fg: "#ff0000", bg: "#0000ff" },
      { fg: "#ff1000", bg: "#0000ee" },
      { fg: "#123456", bg: null },
      { fg: null, bg: null },
      { fg: "#00ff00", bg: null },
    ]);
    expect(spanCount(omitted)).toBe(4);
  });

  it("requires BOTH fg and bg within tolerance independently — fg-only or bg-only proximity never merges", () => {
    // Cell 0/1: fg identical, bg far apart (redmean > 400) -> must NOT merge
    // even at a generous tolerance.
    // Cell 2/3: bg identical, fg far apart -> must NOT merge either.
    const char = ["a", "b", "c", "d"];
    const fg: (string | null)[] = ["#000000", "#000000", "#000000", "#ffffff"];
    const bg: (string | null)[] = ["#000000", "#ffffff", "#000000", "#000000"];
    const out = encodeGlyphBuffersDual(char, fg, bg, 4, 1, true, 100);
    expect(spanCount(out)).toBe(4);
  });

  it("merges when BOTH fg and bg are within tolerance of the run anchor", () => {
    const char = ["a", "b", "c"];
    const fg: (string | null)[] = ["#404040", "#414040", "#424040"];
    const bg: (string | null)[] = ["#101010", "#111010", "#121010"];
    const out = encodeGlyphBuffersDual(char, fg, bg, 3, 1, true, 40);
    expect(out).toBe(`<span style="color:#404040;background-color:#101010">abc</span>`);
  });

  it("never merges a covered cell into an uncovered (null) neighbor regardless of tolerance", () => {
    const char = ["▀", " ", "▀"];
    const fg: (string | null)[] = ["#404040", null, "#414040"];
    const bg: (string | null)[] = [null, null, null];
    const out = encodeGlyphBuffersDual(char, fg, bg, 3, 1, true, 765);
    expect(out).toBe(
      `<span style="color:#404040">▀</span>` + " " + `<span style="color:#414040">▀</span>`,
    );
  });

  // Real-scene measurement (see the describe-block comment above): a smooth
  // icosphere rendered through the real halfblock pipeline, per-cell fg/bg
  // reconstructed losslessly from the real (tolerance-0) HTML output, then
  // re-encoded through this same encoder at rising tolerance. Pinned here as
  // a smaller synthetic stand-in with the same qualitative shape (smoothly
  // drifting fg alongside a smoothly drifting bg) so the real span-reduction
  // claim has a regression test, without shipping the full bench harness.
  it("span count is non-increasing as colorTolerance rises on a smoothly-varying two-channel grid (measured shape, not a general guarantee)", () => {
    const { char, fg, bg, cols } = buildDualSmoothGrid();
    const tolerances = [0, 8, 16, 32, 64, 128];
    const spanCounts = tolerances.map((t) => spanCount(encodeGlyphBuffersDual(char, fg, bg, cols, 1, true, t)));
    for (let i = 1; i < spanCounts.length; i++) {
      expect(spanCounts[i]!).toBeLessThanOrEqual(spanCounts[i - 1]!);
    }
    expect(spanCounts[spanCounts.length - 1]!).toBeLessThan(spanCounts[0]!);
  });

  // P2 (blocking), COLOR-TOLERANCE.md review: `encodeGlyphBuffersDual` had NO
  // bounded-error test at all. Mutation-verified against the exact bug Phase
  // 1 already caught once on the single-color path — comparing each channel
  // against the PREVIOUS cell (`prevFg`/`prevBg`) while still emitting the
  // anchor's color — reintroduced here and confirmed to pass every other
  // test in this file (585) while collapsing this fixture to 1 span with fg
  // error 285.05 (35x the tolerance-8 bound); the anchor-correct
  // implementation gives 7.91 / 31 spans. Both channels are checked
  // independently since a per-channel bug (e.g. only fg using the wrong
  // reference) would otherwise hide behind a passing bg channel.
  it("no cell's output fg/bg colour differs from its true colour by more than colorTolerance (redmean)", () => {
    const { char, fg, bg, cols } = buildDualSmoothGrid();
    const tolerance = 8;
    const out = encodeGlyphBuffersDual(char, fg, bg, cols, 1, true, tolerance);
    const decoded = decodeDualSpanColors(out);
    expect(decoded.length).toBe(cols);

    let maxFgError = 0;
    let maxBgError = 0;
    let mergedSomeCell = false;
    for (let i = 0; i < cols; i++) {
      expect(decoded[i]!.fg).not.toBeNull();
      expect(decoded[i]!.bg).not.toBeNull();
      const fgError = redmeanDistance(fg[i]!, decoded[i]!.fg!);
      const bgError = redmeanDistance(bg[i]!, decoded[i]!.bg!);
      maxFgError = Math.max(maxFgError, fgError);
      maxBgError = Math.max(maxBgError, bgError);
      expect(fgError).toBeLessThanOrEqual(tolerance + 1e-6);
      expect(bgError).toBeLessThanOrEqual(tolerance + 1e-6);
      if (decoded[i]!.fg !== fg[i] || decoded[i]!.bg !== bg[i]) mergedSomeCell = true;
    }
    // Meaningful, not a vacuous pass: the tolerance actually merged some
    // cells (pinned reviewer numbers — see comment above), and the row
    // doesn't collapse into one giant out-of-bounds run.
    expect(mergedSomeCell).toBe(true);
    expect(spanCount(out)).toBe(31);
    expect(maxFgError).toBeCloseTo(7.91, 1);
    expect(maxBgError).toBeCloseTo(7.90, 1);
  });

  // Finding 3 (COLOR-TOLERANCE.md review, Phase 2): mirrors Phase 1's own
  // Finding 3 for the dual encoder. The `colorTolerance > 0` guard
  // (cells.ts:600-601) must gate BOTH the tolerance machinery's allocation
  // (the per-call `Map` cache) and whether a numerically-identical but
  // string-distinct color (case-variant hex) can merge — independently on
  // fg AND bg. Mutating either guard to `>= 0` passes the entire 593-test
  // run but lets a redmean-0, string-distinct fg or bg pair merge at the
  // nominally-off tolerance, and allocates a `Map` on every default-path
  // halfblock/quadrant render.
  it("colorTolerance 0 (default/off) never engages the tolerance machinery on either channel: case-variant hex fg/bg stay distinct spans and cost zero parses", () => {
    const char = ["a", "b"];

    // fg case-variant (redmean 0), bg string-identical -> must stay 2 spans.
    const fgCaseVariant: (string | null)[] = ["#AABBCC", "#aabbcc"];
    const bgSame: (string | null)[] = ["#112233", "#112233"];
    const expectedFgCase =
      `<span style="color:#AABBCC;background-color:#112233">a</span>`
      + `<span style="color:#aabbcc;background-color:#112233">b</span>`;
    resetGlyphColorParseCountForTests();
    expect(encodeGlyphBuffersDual(char, fgCaseVariant, bgSame, 2, 1, true)).toBe(expectedFgCase);
    expect(encodeGlyphBuffersDual(char, fgCaseVariant, bgSame, 2, 1, true, 0)).toBe(expectedFgCase);
    expect(getGlyphColorParseCountForTests()).toBe(0);

    // bg case-variant (redmean 0), fg string-identical -> must stay 2 spans.
    const fgSame: (string | null)[] = ["#112233", "#112233"];
    const bgCaseVariant: (string | null)[] = ["#AABBCC", "#aabbcc"];
    const expectedBgCase =
      `<span style="color:#112233;background-color:#AABBCC">a</span>`
      + `<span style="color:#112233;background-color:#aabbcc">b</span>`;
    resetGlyphColorParseCountForTests();
    expect(encodeGlyphBuffersDual(char, fgSame, bgCaseVariant, 2, 1, true)).toBe(expectedBgCase);
    expect(encodeGlyphBuffersDual(char, fgSame, bgCaseVariant, 2, 1, true, 0)).toBe(expectedBgCase);
    expect(getGlyphColorParseCountForTests()).toBe(0);
  });

  it("bounds withinColorTolerance calls by the pre-merge span count, not the cell count", () => {
    const cols = 64;
    const char: string[] = [];
    const fg: (string | null)[] = [];
    const bg: (string | null)[] = [];
    for (let col = 0; col < cols; col++) {
      const t = col / (cols - 1);
      const fr = Math.round(40 + t * 180);
      char.push("▀");
      fg.push(`#${[fr, 80, 90].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      bg.push("#101010");
    }
    const preMergeSpanCount = spanCount(encodeGlyphBuffersDual(char, fg, bg, cols, 1, true, 0));

    resetGlyphColorToleranceCallCountForTests();
    encodeGlyphBuffersDual(char, fg, bg, cols, 1, true, 20);
    const callCount = getGlyphColorToleranceCallCountForTests();

    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThanOrEqual(preMergeSpanCount * 2); // fg + bg checked independently
    expect(callCount).toBeLessThan(cols * 2);
  });
});
