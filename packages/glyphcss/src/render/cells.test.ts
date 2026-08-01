import { describe, expect, it } from "vitest";
import {
  buildCellGrid,
  cloneCellGrid,
  encodeCellGrid,
  encodeGlyphBuffers,
  encodeGlyphBuffersDual,
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
